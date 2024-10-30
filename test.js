import express from "express";
import multer from "multer";
import { FilecoinNode } from "./numb.js";
import path from "path";
import process from "process";
import { error } from "console";
import bodyParser from "body-parser";
import cors from "cors";

const app = express();
const port = 3000;

const corsOptions = {
  origin: "*",
  optionsSuccessStatus: 200,
};

app.use(bodyParser.json());
app.use(cors(corsOptions));

const upload = multer({ dest: "uploads/" });

const filecoinNode = new FilecoinNode(4002, "");
await filecoinNode.init();

app.use(express.static("public"));

app.post("/upload", async (req, res) => {
  const filePath = "./goland-2024.1.4.exe";
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
  const result = await filecoinNode.retrieveBlock(
    "bafyreidgewugbq56jvrfgyyxwq6dqywmum6tqzp45nftduwze4dyakoibi"
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
