// ------------------ IMPORTS ------------------
const express = require("express");
const fetch = require("node-fetch");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const AWS = require("aws-sdk");
const ffmpeg = require("fluent-ffmpeg");
const bodyParser = require("body-parser");
const axios = require("axios");

// ------------------ APP SETUP ------------------
const app = express();
app.use(bodyParser.json({ limit: "10mb" }));

// ENV
const WORKER_SECRET = process.env.WORKER_SECRET;
const S3_BUCKET = process.env.S3_BUCKET;

const S3 = new AWS.S3({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

// ------------------ OPENAI SCENE GENERATOR ------------------
async function generateScenePrompts(script) {
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Break the script into 3-6 short, visual animation scenes. For each scene, generate a strong visual description. No titles, no text overlays, no screen instructions."
          },
          { role: "user", content: script }
        ],
        temperature: 0.9,
      }),
    });

    const data = await res.json();
    console.log("OpenAI scene data:", data.choices?.[0]?.message?.content);

    const scenes = data.choices[0].message.content
      .split("\n")
      .map(s => s.trim())
      .filter(s => s.length > 0);

    return scenes;
  } catch (err) {
    console.log("OpenAI error:", err);
    return [script]; // fallback
  }
}

// ------------------ HELPERS ------------------
async function downloadVideo(url, dest) {
  const res = await axios.get(url, { responseType: "stream" });
  await new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    res.data.pipe(file);
    file.on("finish", resolve);
    file.on("error", reject);
  });
}

async function concatVideos(files, out) {
  const list = path.join(path.dirname(out), `concat_${Date.now()}.txt`);
  const content = files.map(f => `file '${f}'`).join("\n");
  fs.writeFileSync(list, content);

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(list)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(["-c copy"])
      .save(out)
      .on("end", () => resolve(out))
      .on("error", reject);
  });
}

async function uploadToS3(localPath, key) {
  const Body = fs.createReadStream(localPath);
  await S3.upload({
    Bucket: S3_BUCKET,
    Key: key,
    Body,
    ACL: "public-read"
  }).promise();

  return `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

// ------------------ JOB STORE ------------------
const JOBS = {};

// ------------------ JOB CREATE ROUTE ------------------
app.post("/jobs", async (req, res) => {
  if (req.headers["x-worker-secret"] !== WORKER_SECRET)
    return res.status(401).send("Unauthorized");

  const { script } = req.body;
  const jobId = uuidv4();

  JOBS[jobId] = {
    status: "queued",
    progress: 0,
    url: null,
  };

  res.json({ jobId });

  // background async task
  (async () => {
    try {
      JOBS[jobId].status = "running";

      // 🔥 New — Scene generation using OpenAI
      const scenes = await generateScenePrompts(script);

      JOBS[jobId].totalScenes = scenes.length;

      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "animexa-"));
      const clips = [];

      for (let i = 0; i < scenes.length; i++) {
        JOBS[jobId].progress = Math.round((i / scenes.length) * 50);

        const prompt = `${scenes[i]}. 3-6 sec animated motion. No text. colorful animation style.`;

        const pollUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(
          prompt
        )}?video=1`;

        const file = path.join(tmpDir, `clip_${i}.mp4`);
        await downloadVideo(pollUrl, file);

        clips.push(file);
      }

      JOBS[jobId].progress = 60;

      const final = path.join(tmpDir, `final_${jobId}.mp4`);
      await concatVideos(clips, final);

      JOBS[jobId].progress = 90;

      const key = `jobs/${jobId}/final.mp4`;
      const url = await uploadToS3(final, key);

      JOBS[jobId].status = "succeeded";
      JOBS[jobId].progress = 100;
      JOBS[jobId].url = url;

    } catch (e) {
      console.log("Job error:", e);
      JOBS[jobId].status = "failed";
      JOBS[jobId].error = String(e);
    }
  })();
});

// ------------------ JOB STATUS ROUTE ------------------
app.get("/jobs/:id", (req, res) => {
  if (req.headers["x-worker-secret"] !== WORKER_SECRET)
    return res.status(401).send("Unauthorized");

  const job = JOBS[req.params.id];
  if (!job) return res.status(404).json({ status: "not-found" });

  res.json(job);
});

// ------------------ START SERVER ------------------
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log("🔥 Worker running on", PORT));
