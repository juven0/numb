import { PoRep } from "./PoRep.js";

const porep = new PoRep();

const blockData = "Contenu du fichier ou du bloc";
const nodePublicKey = "Clé publique du nœud";
const encodedBlock = porep.encodeBlockForNode(blockData, nodePublicKey);

console.log("Bloc encodé pour ce nœud:", encodedBlock);
