import { createLibp2p } from "libp2p";
import { tcp } from "@libp2p/tcp";
import { mplex } from "@libp2p/mplex";
import { noise } from "@chainsafe/libp2p-noise";
import { kadDHT } from "@libp2p/kad-dht";
import { multiaddr } from "@multiformats/multiaddr";
import * as Block from "multiformats/block";
import * as dagCBOR from "@ipld/dag-cbor";
import { sha256 } from "multiformats/hashes/sha2";
import fs from "fs/promises";
import { mdns } from "@libp2p/mdns";
import crypto from "crypto";
import { tls } from "@libp2p/tls";
import { yamux } from "@chainsafe/libp2p-yamux";
import { identify } from "@libp2p/identify";
import { CID } from "multiformats/cid";
import { bootstrap } from "@libp2p/bootstrap";
import { DHT } from "./dht/dht.js";
import { BlockChain } from "./blockchain/blockchain.js";
import { FileMetadata } from "./blockchain/fileMetadata.js";
import { BlockIteme } from "./blockchain/block.js";

class FilecoinNode {
  constructor(listenPort) {
    this.node = null;
    this.wallet = null;
    this.storage = new Map();
    this.deals = new Map();
    this.BLOCK_SIZE = 256 * 1024; // 256 KB
    this.listenPort = listenPort;
  }

  async init() {
    this.node = await createLibp2p({
      addresses: {
        listen: [`/ip4/0.0.0.0/tcp/${this.listenPort}`],
      },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],

      services: {
        identify: identify(),
      },
      peerDiscovery: [mdns()],
      nat: true,
      relay: {
        enabled: true,
        hop: {
          enabled: true,
          active: true,
        },
      },
    });

    this.DHT = new DHT(this.node);
    this.BlockChain = new BlockChain();
    this.DHT.start();

    this.wallet = {
      address: crypto.randomBytes(20).toString("hex"),
      balance: 1000, // Initial balance in FIL
    };

    this.node.addEventListener("peer:discovery", async (evt) => {
      console.log("Discovered:", evt.detail.id.toString());
      const peerId = evt.detail.id;
      const peerMultiaddr = evt.detail.multiaddrs[0].toString();
      console.log("Discovered peer:", peerId.toString());

      try {
        await this.connectToPeer(peerMultiaddr);
        await this.sendWelcomeMessage(peerId);
      } catch (err) {
        console.error(`Échec de la connexion au pair ${peerId}:`, err);
      }
    });

    this.node.handle("/nebula/welcome/1.0.0", async ({ stream }) => {
      const message = await stream.source.next();
      console.log(
        "Received welcome message:",
        message.value.bufs[0].toString("utf8")
      );
      await stream.close();
    });

    this.node.handle("/nebula/blocks/1.0.0", async ({ stream }) => {
      const message = await stream.source.next();
      const { cid } = JSON.parse(message.value.toString());
      const block = this.storage.get(cid);
      if (block) {
        await stream.sink.next(Buffer.from(JSON.stringify(block)));
      }
      await stream.close();
    });
    this.node.handle("/nebula/blocksstore/1.0.0", async ({ stream }) => {
      const message = await stream.source.next();

      try {
        const block = JSON.parse(message.value.toString());
        const cid = block.cid;

        this.storage.set(cid, block);
        console.log("Bloc reçu et stocké avec CID:", cid);

        await stream.sink.next(Buffer.from("Bloc reçu et stocké"));
      } catch (err) {
        console.error(
          "Erreur lors de la réception et du stockage du bloc:",
          err
        );
      }

      await stream.close();
    });

    await this.node.start();
    console.log("Node started with ID:", this.node.peerId.toString());
    console.log(
      "Listening on:",
      this.node
        .getMultiaddrs()
        .map((ma) => ma.toString())
        .join(", ")
    );

    console.log("Wallet address:", this.wallet.address);
  }

  async connectToPeer(peerMultiaddr) {
    const ma = multiaddr(peerMultiaddr);
    await this.node.dial(ma);
    console.log("Connected to peer:", peerMultiaddr);
  }
  async sendWelcomeMessage(peerId) {
    try {
      const connection = await this.node.dial(peerId);
      const stream = await connection.newStream(["/nebula/welcome/1.0.0"]);
      const welcomeMessage = `Bienvenue du noeud ${this.node.peerId.toString()}!`;
      const messageBuffer = Buffer.from(welcomeMessage);

      await stream.sink([messageBuffer]);

      await stream.close();
      console.log("Sent welcome message to peer:", peerId.toString());
    } catch (err) {
      console.error("Failed to send welcome message:", err);
    }
  }
  async splitAndStoreFile(filePath, name) {
    const fileContent = await fs.readFile(filePath);
    const stats = await fs.stat(filePath);
    const hash = crypto.createHash("sha256").update(fileContent).digest("hex");
    const fileMetaData = new FileMetadata(name, stats.size, hash);

    const previousHash = this.BlockChain.getLasteBlock().hash;
    const index = this.BlockChain.getLasteBlock().index;

    const newBlock = new BlockIteme(
      index + 1,
      previousHash,
      fileMetaData,
      Date.now(),
      [],
      []
    );

    const blocks = [];
    const Cids = [];
    for (let i = 0; i < fileContent.length; i += this.BLOCK_SIZE) {
      const chunk = fileContent.slice(i, i + this.BLOCK_SIZE);

      const block = await Block.encode({
        value: chunk,
        codec: dagCBOR,
        hasher: sha256,
      });

      blocks.push(block);
      Cids.push(block.cid);
      await this.storeBlock(block);
    }
    newBlock.cids = Cids;
    this.BlockChain.addBlock(newBlock);
    console.log(this.BlockChain);
    return blocks;
  }
  async ensureDHTStarted() {
    const peerIds = await this.node.peerStore.all();
  }
  async storeBlock(block) {
    this.DHT.put(block.cid, block);
    // const providers = await this.node.contentRouting.provide(block.cid, {
    //   timeout: 20000,
    // });
    // if (connections.length > 0) {
    //   for (const provider of providers) {
    //     try {
    //       console.log("Envoi du bloc à un pair :", provider.id.toString());
    //       const { stream } = await this.node.dialProtocol(
    //         provider.id,
    //         "/nebula/strorbloc/1.0.0"
    //       );
    //       await stream.sink.next(Buffer.from(JSON.stringify(block)));
    //       await stream.close();
    //       console.log("Bloc partagé avec le pair:", provider.id.toString());
    //     } catch (err) {
    //       console.error("Échec de l'envoi du bloc au pair:", err);
    //     }
    //   }
    // }

    // try {
    //   // await this.ensureDHTStarted();
    //   await this.node.contentRouting.provide(block.cid, { timeout: 20000 });
    //   console.error("publier");
    // } catch (err) {
    //   console.error("Erreur lors de la publication du CID:", err);
    // }

    return;
  }

  async retrieveFile(fileMetadata) {
    const blocks = [];
    for (const blockCID of fileMetadata.blocks) {
      const block = await this.retrieveBlock(blockCID);
      blocks.push(block);
    }
    const fileContent = Buffer.concat(blocks.map((b) => b.value));
    await fs.writeFile(fileMetadata.name, fileContent);
    console.log("File retrieved and saved:", fileMetadata.name);
    return fileContent;
  }

  async retrieveBlock(cid) {
    try {
      const value = await this.DHT.get(cid);
      return value;
    } catch {
      console.log("error .. ");
    }
  }
}

export { FilecoinNode };
