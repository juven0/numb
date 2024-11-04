import express from "express";
import multer from "multer";
import { FilecoinNode } from "./numb.js";
import path from "path";
import process from "process";
import { error } from "console";
import bodyParser from "body-parser";
import cors from "cors";
import { hash } from "crypto";

const app = express();
const port = 3000;

const corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200,
};

app.use(bodyParser.json());
app.use(cors(corsOptions));

const upload = multer({ dest: "uploads/" });

const filecoinNode = new FilecoinNode(4002, "./test");
await filecoinNode.init();

app.use(express.static("public"));

app.post("/upload", async (req, res) => {
  const filePath = "./original-f9a8e6a46c0bf919b14ade317b8c2af0.mp4";
  const name = path.basename(filePath);
  try {
    const blocks = await filecoinNode.splitAndStoreFile(filePath, name);
    console.log(
      "Fichier découpé et stocké en blocs :",
      blocks.map((block) => block.cid.toString())
    );

    res.status(200).send({
      message: "Fichier uploadé et stocké avec succès!",
      blocks: blocks.map((block) => block.cid.toString()),
    });
  } catch (err) {
    console.error("Erreur lors du stockage du fichier:", err);
    res.status(500).send("Erreur lors du stockage du fichier");
  }
});

app.get("/get", async (req, res) => {
  const result = await filecoinNode.retrieveAndSaveFile(
    "1d5ef02fc175301b8b4675112df2902e25c32842e72fbc9ab43bd5b79a099b40",
    "./out/"
  );

  res.status(200).send({
    message: result,
  });
});

app.post("/user/create", async (req, res) => {
  const userName = req.body.username;
  try {
    const newUser = await filecoinNode.createUser(userName);
    res.status(200).send({
      user: newUser,
    });
  } catch (error) {
    res.status(500).send(`error to create ${userName}`);
  }
});

app.get("/user/files/:id", async (req, res) => {
  const userId = req.params.id;
  try {
    const files = await filecoinNode.getUserFiles(userId);
    res.status(200).send({
      files: files,
    });
  } catch (error) {
    res.status(500).send(`error to get your files `);
  }
});

app.get("/user/file/:hash", async (req, res) => {
  const hash = req.params.hash;
  try {
    const file = await filecoinNode.retrieveUserFile(hash);
    res.status(200).send({
      files: file,
    });
  } catch (error) {
    res.status(500).send(`error to get  ${hash}`);
  }
});

app.post("/user/login", async (req, res) => {
  const userInfo = req.body;
  try {
    const user = await filecoinNode.UserLogin(
      userInfo.userid,
      userInfo.privatekey
    );
    res.status(200).send({
      user: user,
    });
  } catch (error) {
    res.status(500).send(`login faild `);
  }
});

app.listen(port, () => {
  console.log(`Serveur web démarré sur http://localhost:${port}`);
});
