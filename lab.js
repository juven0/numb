import { create } from 'ipfs-core';
import fs from 'fs/promises';
import crypto from 'crypto';
import  mdns  from "multicast-dns";
import { multiaddr } from '@multiformats/multiaddr';
import { CID } from 'multiformats/cid';
import { peerIdFromString } from '@libp2p/peer-id';


class FilecoinNode {
  constructor(port) {
    this.node = null;
    this.wallet = null;
    this.storage = new Map(); // Simule le stockage local des blocs
    this.BLOCK_SIZE = 256 * 1024; // 256 KB par bloc
    this.port = port; // Chaque nœud aura un port différent
    this.mdns = mdns();
    this.replicationFactor = 3;
    this.isReady = false;
    this.connectedPeers = new Set();
    this.MIN_PEERS_FOR_PUBLISH = 1;
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
        pubsub: true,
      },
      discovery: {
        MDNS: {
          enabled: true,
          interval: 10000,
        },
      },
    });

    const id = await this.node.id();
    console.log(`Nœud IPFS démarré avec l'ID : ${id.id}`);

    this.wallet = {
      address: crypto.randomBytes(20).toString('hex'),
      balance: 1000, // Solde initial
    };

    await this.setupPubSub();

    this.listenForWelcomeMessages()
    if (this.node && this.node.isOnline()) {
        await this.node.stop();
        console.log('Nœud arrêté avec succès.');
      }
    await this.node.start();

    this.enableAutoDiscovery();
    // await this.node.pubsub.subscribe('nebula-welcome', this.handleWelcomeMessage.bind(this));

    this.node.libp2p.addEventListener('peer:connect', this.handlePeerConnect.bind(this));
    this.node.libp2p.addEventListener('peer:disconnect', this.handlePeerDisconnect.bind(this));


    this.checkAndSetReady();
    setInterval(() => this.rebalanceStorage(), 60000);

  }

  async setupPubSub() {
    const topic = 'nebula-welcome';
    await this.node.pubsub.subscribe(topic, (msg) => {
      this.handleWelcomeMessage(msg);
    });
    console.log(`Abonné au topic: ${topic}`);
  }

  async checkAndSetReady() {
    const peers = await this.getConnectedPeers();
    if (peers.length >= 1) {
      this.isReady = true;
      console.log("Le nœud est prêt avec suffisamment de pairs connectés.");
      await this.sendWelcomeMessage();
    } else {
      console.log("Pas assez de pairs connectés. Réessai dans 5 secondes...");
      setTimeout(() => this.checkAndSetReady(), 5000);
    }
  }

  handlePeerConnect(event) {
    console.log(`Nouveau pair connecté: ${event.detail.id.toString()}`);
    if (!this.isReady) {
      this.checkAndSetReady();
    }
  }

  handlePeerDisconnect(event) {
    console.log(`Pair déconnecté: ${event.detail.id.toString()}`);
  }

  async sendWelcomeMessage(retries = 3) {
    if (!this.isReady) {
      console.log("Le nœud n'est pas prêt. Message de bienvenue non envoyé.");
      return;
    }

    try {
      const message = `Bienvenue du noeud ${await this.node.id()}!`;
      await this.node.pubsub.publish('nebula-welcome', new TextEncoder().encode(message));
      console.log("Message de bienvenue envoyé avec succès.");
    } catch (error) {
      console.error("Erreur lors de l'envoi du message de bienvenue:", error.message);
      if (retries > 0) {
        console.log(`Nouvelle tentative dans 5 secondes. Tentatives restantes: ${retries}`);
        setTimeout(() => this.sendWelcomeMessage(retries - 1), 20000);
      }
    }
  }



  handleWelcomeMessage(msg) {
    const message = new TextDecoder().decode(msg.data);
    console.log('Message reçu:', message);
    console.log('De:', msg.from);
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
//   async splitAndStoreFile(filePath) {
//     const fileContent = await fs.readFile(filePath);
//     const blocks = [];
//     for (let i = 0; i < fileContent.length; i += this.BLOCK_SIZE) {
//       const chunk = fileContent.slice(i, i + this.BLOCK_SIZE);
//       const { cid } = await this.node.add(chunk); // Ajout du bloc à IPFS
//       blocks.push(cid);
//       this.storage.set(cid.toString(), chunk);
//       console.log("Bloc stocké avec CID:", cid.toString());
//     }
//     return blocks;
//   }
// async splitAndStoreFile(filePath) {
//     const fileContent = await fs.readFile(filePath);
//     const blocks = [];
//     for (let i = 0; i < fileContent.length; i += this.BLOCK_SIZE) {
//         const chunk = fileContent.slice(i, i + this.BLOCK_SIZE);
//         const { cid } = await this.node.add(chunk); // Ajout du bloc à IPFS
//         blocks.push(cid);
//         this.storage.set(cid.toString(), chunk);
//         console.log("Bloc stocké avec CID:", cid.toString());

//         // Publier le CID dans la DHT
//         try {
//             await this.node.dht.provide(cid);
//             console.log(`CID ${cid.toString()} publié dans la DHT.`);
//         } catch (err) {
//             console.error(`Erreur lors de la publication du CID: ${err.message}`);
//         }

//         // Essayer de se connecter à d'autres nœuds pour répartir le stockage
//         await this.connectToOtherPeers(cid);

//     }
//     return blocks;
// }



async splitAndStoreFile(filePath) {
    const fileContent = await fs.readFile(filePath);
    const blocks = [];
    for (let i = 0; i < fileContent.length; i += this.BLOCK_SIZE) {
      const chunk = fileContent.slice(i, i + this.BLOCK_SIZE);
      const { cid } = await this.node.add(chunk);
      blocks.push(cid);

      await this.storeAndDistributeBlock(cid, chunk);
    }
    return blocks;
  }

  async storeAndDistributeBlock(cid, block) {
    this.storage.set(cid.toString(), block);
    console.log(`Bloc stocké localement avec CID: ${cid.toString()}`);

    await this.node.dht.provide(cid);

    const peers = await this.getConnectedPeers();
    const targetPeers = this.selectTargetPeers(peers, this.replicationFactor - 1);

    for (const peer of targetPeers) {
      try {
        await this.connectToPeer(peer);
        console.log(`Connecté au pair ${peer.toString()} pour partager le bloc ${cid.toString()}`);
      } catch (err) {
        console.error(`Erreur lors de la connexion au pair ${peer.toString()}: ${err.message}`);
      }
    }
  }

  async getConnectedPeers() {
    const peerInfos = await this.node.swarm.peers();
    return peerInfos.map(peerInfo => peerInfo.peer);
  }

  selectTargetPeers(peers, count) {
    return peers.sort(() => 0.5 - Math.random()).slice(0, count);
  }

  async rebalanceStorage() {
    const peers = await this.getConnectedPeers();
    for (const [cidString, block] of this.storage.entries()) {
      const cid = CID.parse(cidString);
      const providers = await this.findProviders(cid);
      if (providers.length < this.replicationFactor) {
        const missingCopies = this.replicationFactor - providers.length;
        const targetPeers = this.selectTargetPeers(
          peers.filter(p => !providers.includes(p.toString())),
          missingCopies
        );
        for (const peer of targetPeers) {
          try {
            await this.connectToPeer(peer);
            console.log(`Connecté au pair ${peer.toString()} pour rééquilibrer le bloc ${cidString}`);
          } catch (err) {
            console.error(`Erreur lors de la connexion au pair ${peer.toString()} pour le rééquilibrage: ${err.message}`);
          }
        }
      }
    }
  }

  async findProviders(cid) {
    const providers = [];
    for await (const provider of this.node.dht.findProvs(cid)) {
      providers.push(provider.id.toString());
    }
    return providers;
  }

  async connectToPeer(peer) {
    try {
      const peerInfo = await this.node.peerRouting.findPeer(peer);
      if (peerInfo && peerInfo.multiaddrs.length > 0) {
        await this.node.swarm.connect(peerInfo.multiaddrs[0]);
      } else {
        throw new Error("Aucune adresse multiaddr trouvée pour le pair");
      }
    } catch (error) {
      console.error(`Erreur lors de la connexion au pair: ${error.message}`);
      throw error;
    }
  }


async connectToOtherPeers(cid) {
    // Trouver des pairs dans la DHT qui peuvent stocker le CID
    const providers = await this.node.dht.findProvs(cid);
    for await (const provider of providers) {
        console.log(provider)
        // try {
        //     await this.node.swarm.connect(provider.multiaddrs[0]);
        //     console.log(`Connecté à ${provider}`);
        // } catch (err) {
        //     console.error(`Erreur lors de la connexion à ${provider}: ${err.message}`);
        // }
    }
}

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

  enableAutoDiscovery() {
    const connectedPeers = new Set();

    this.node.libp2p.addEventListener('peer:discovery', async (event) => {
      const peerId = event.detail.id.toString();
      if (!connectedPeers.has(peerId)) {
        console.log(`Pair découvert: ${peerId}`);
        try {
          const peerInfo = await this.node.swarm.peers();
          const peer = peerInfo.find((p) => p.peer.toString() === peerId);

          if (peer && peer.addr) {
            console.log(`Connexion à l'adresse: ${peer.addr.toString()}`);
            await this.node.swarm.connect(event.detail.multiaddrs[0],  { timeout: 30000 });
            connectedPeers.add(peerId);  // Ajouter le peer une fois connecté
            console.log(`Connecté au pair: ${peerId}`);
            const peerIn = await this.node.swarm.peers();
            console.log('Pairs connectés :', peerIn);
            const filePath = './myDoc.txt';
            const blocks = await this.splitAndStoreFile(filePath);
            console.log('Fichier découpé et stocké en blocs:', blocks);

    // Simulation de récupération de fichier
            const fileMetadata = {
                name: 'recoveredFile.txt',
                blocks: blocks.map((cid) => cid.toString()),
            };
            await this.retrieveFile(fileMetadata);
                    return

          } else {
            console.error(`Aucune adresse trouvée pour le pair: ${peerId}`);
          }
        } catch (err) {
          console.error(`Erreur lors de la connexion au pair: ${err.message}`);
        }
      } else {
        //console.log(`Pair déjà connecté: ${peerId}`);
      }
    });

    // setInterval(async () => {
    //   try {
    //     const peers = await this.node.swarm.peers();
    //     console.log(`Nombre de pairs connectés: ${peers.length}`);
    //     peers.forEach((peer) => {
    //       console.log(`- Pair: ${peer.peer} (${peer.addr})`);
    //     });
    //   } catch (err) {
    //     console.error(`Erreur lors de la récupération des pairs: ${err.message}`);
    //   }
    // }, 30000);  // Allonge l'intervalle à 30 secondes
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
  const port =process.argv[2] || 4003;
  const node = new FilecoinNode(port);
  await node.init();



  // Connexion à un autre nœud (si disponible)
  if (process.env.PEER) {
    await node.connectToPeer(process.env.PEER);
  }
}

// Démarrer plusieurs nœuds avec différents ports
main().catch(console.error);
