import express from "express";
import multer from "multer";
import { FilecoinNode } from "./numb.js";
import path from "path";
import process from "process";

const app = express();
const port = 3000;
const upload = multer({ dest: "uploads/" });

const filecoinNode = new FilecoinNode(4002);
await filecoinNode.init();

app.use(express.static("public"));

app.post("/upload", async (req, res) => {
  const filePath = "./myDoc.txt";
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

app.listen(port, () => {
  console.log(`Serveur web démarré sur http://localhost:${port}`);
});
