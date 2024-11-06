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

// const upload = multer({ dest: "uploads/" });

const filecoinNode = new FilecoinNode(4002, "./test");
await filecoinNode.init();

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});

const upload = multer({ storage });
app.use(express.static("public"));

app.post("/upload", upload.single("file"), async (req, res) => {
  const filePath = "./uploads/" + req.file.originalname;
  const name = path.basename(filePath);
  try {
    const blocks = await filecoinNode.splitAndStoreFile(
      filePath,
      name,
      req.body.userId,
      req.body.privatekey,
      req.body.pubkey
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

app.post("/get", async (req, res) => {
  const result = await filecoinNode.retrieveAndSaveFile(
    "5be5e484ed1547664e93de3a892ece9397aa9e7133a303e4b77dabe16f777f79",
    "./out/",
    req.body.publicKey,
    req.body.privateKey
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
