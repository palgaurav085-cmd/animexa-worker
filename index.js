import express from "express";
import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json());

// Initialize OpenAI client
const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// API route
app.post("/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt required" });
    }

    // OpenAI call
    const aiRes = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You generate scene descriptions for creating animation videos.",
        },
        { role: "user", content: prompt },
      ],
    });

    const output = aiRes.choices[0].message.content;

    return res.json({ result: output });
  } catch (err) {
    console.error("❌ Error:", err);
    res.status(500).json({
      error: err.message || "Internal server error",
    });
  }
});

// Start server
app.listen(10000, () => {
  console.log("🔥 Backend running on port 10000");
});

