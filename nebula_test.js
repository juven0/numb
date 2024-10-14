import { FilecoinNode } from "./numb.js";

async function testSplitAndStore() {
  const filecoinNode = new FilecoinNode(4002);
  await filecoinNode.init();

  const filePath = "./myDoc.txt";
  const blocks = await filecoinNode.splitAndStoreFile(filePath);

  console.log(
    "Fichier découpé et stocké en blocs :",
    blocks.map((block) => block.cid.toString())
  );
}

testSplitAndStore();
