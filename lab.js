import { create } from 'ipfs-core';
import fs from 'fs/promises';
import crypto from 'crypto';

class FilecoinNode {
  constructor(port) {
    this.node = null;
    this.wallet = null;
    this.storage = new Map(); // Simule le stockage local des blocs
    this.BLOCK_SIZE = 256 * 1024; // 256 KB par bloc
    this.port = port; // Chaque nœud aura un port différent
  }

  // Initialisation du nœud IPFS
  async init() {
    this.node = await create({
      repo: `./ipfs-repo-node-${this.port}`, // Répertoire unique pour chaque nœud
      config: {
        Addresses: {
          Swarm: [
            `/ip4/0.0.0.0/tcp/${this.port}`,
            `/ip4/127.0.0.1/tcp/${this.port + 1}/ws`, // WebSocket pour chaque nœud
          ],
        },
      },
      EXPERIMENTAL: {
        pubsub: true, // Activer pubsub pour les communications
      },
      discovery: {
        mdns: {
          enabled: true,
          interval: 10000, // Découverte locale via mDNS
        },
      },
    });

    const id = await this.node.id();
    console.log(`Nœud IPFS démarré avec l'ID : ${id.id}`);

    this.wallet = {
      address: crypto.randomBytes(20).toString('hex'),
      balance: 1000, // Solde initial
    };

    // Gérer les messages de bienvenue pour la découverte des pairs

    this.listenForWelcomeMessages()
    await this.node.start();
    console.log(
      "Listening on:",
      this.node.getMultiaddrs().map((ma) => ma.toString()).join(", ")
    );
  }

  async sendWelcomeMessage() {
    const topic = 'nebula-welcome';
    const message = `Bienvenue du noeud ${this.node.id().id}!`;
    await this.node.pubsub.publish(topic, new TextEncoder().encode(message));
    console.log(`Message de bienvenue envoyé: ${message}`);
  }

  async listenForWelcomeMessages() {
    const topic = 'nebula-welcome';
    await this.node.pubsub.subscribe(topic, (msg) => {
      const message = new TextDecoder().decode(msg.data);
      console.log('Message reçu:', message);
    });
    console.log('En attente des messages sur le sujet:', topic);
  }


  // Découper un fichier en blocs et les stocker dans IPFS
  async splitAndStoreFile(filePath) {
    const fileContent = await fs.readFile(filePath);
    const blocks = [];
    for (let i = 0; i < fileContent.length; i += this.BLOCK_SIZE) {
      const chunk = fileContent.slice(i, i + this.BLOCK_SIZE);
      const { cid } = await this.node.add(chunk); // Ajout du bloc à IPFS
      blocks.push(cid);
      this.storage.set(cid.toString(), chunk);
      console.log("Bloc stocké avec CID:", cid.toString());
    }
    return blocks;
  }

  // Stocker un bloc dans IPFS et le publier dans la DHT
  async storeBlock(block) {
    const { cid } = await this.node.add(block);
    this.storage.set(cid.toString(), block);
    console.log('Bloc stocké avec CID:', cid.toString());

    // Publier le CID dans la DHT
    try {
      await this.node.dht.provide(cid);
      console.log(`CID ${cid.toString()} publié dans la DHT.`);
    } catch (err) {
      console.error(`Erreur lors de la publication du CID: ${err.message}`);
    }
  }

  // Récupérer un fichier à partir de ses métadonnées (CID des blocs)
  async retrieveFile(fileMetadata) {
    const blocks = [];
    for (const blockCID of fileMetadata.blocks) {
      const block = await this.retrieveBlock(blockCID);
      blocks.push(block);
    }
    const fileContent = Buffer.concat(blocks);
    await fs.writeFile(fileMetadata.name, fileContent);
    console.log('Fichier récupéré et sauvegardé:', fileMetadata.name);
    return fileContent;
  }

  // Récupérer un bloc à partir de son CID
  async retrieveBlock(cid) {
    if (this.storage.has(cid)) {
      return this.storage.get(cid);
    }
    console.log(`Recherche de providers pour le CID ${cid} dans la DHT...`);
    const providers = [];
    for await (const provider of this.node.dht.findProvs(cid)) {
      providers.push(provider.id.toString());
      console.log('Provider trouvé:', provider.id.toString());
    }

    try {
      const block = [];
      for await (const chunk of this.node.cat(cid)) {
        block.push(chunk);
      }
      const content = Buffer.concat(block);
      console.log(`Bloc récupéré avec CID: ${cid}`);
      this.storage.set(cid.toString(), content);
      return content;
    } catch (err) {
      console.error(`Erreur lors de la récupération du bloc: ${err.message}`);
      throw new Error('Bloc non trouvé');
    }
  }

  // Connecter un nœud à un autre pair
  async connectToPeer(peerMultiaddr) {
    try {
      await this.node.swarm.connect(peerMultiaddr);
      console.log(`Connecté à un autre nœud à l'adresse : ${peerMultiaddr}`);

      // Envoyer un message de bienvenue via PubSub
      await this.sendWelcomeMessage();
    } catch (err) {
      console.error('Erreur lors de la connexion au pair:', err);
    }
  }

}

// Fonction principale pour créer et tester des nœuds multiples
async function main() {
  const port =process.argv[2] || 4002;
  const node = new FilecoinNode(port);
  await node.init();

  // Simulation d'un ajout de fichier
  const filePath = './myFile.txt';
  const blocks = await node.splitAndStoreFile(filePath);
  console.log('Fichier découpé et stocké en blocs:', blocks);

  // Simulation de récupération de fichier
  const fileMetadata = {
    name: 'recoveredFile.txt',
    blocks: blocks.map((cid) => cid.toString()),
  };
  await node.retrieveFile(fileMetadata);

  // Connexion à un autre nœud (si disponible)
  if (process.env.PEER) {
    await node.connectToPeer(process.env.PEER);
  }
}

// Démarrer plusieurs nœuds avec différents ports
main().catch(console.error);
