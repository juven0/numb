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
import { DistributedUserIdentity } from "./user/DistributedUserIdentity.js";
import { BlockStorage } from "./file/Filestorage.js";
import { FileEncryption } from "./file/filesEncription.js";
import { ShareSystem } from "./file/shareSystem.js";

class FilecoinNode {
  constructor(listenPort, storePath = "./") {
    this.node = null;
    this.wallet = null;
    this.storage = new Map();
    this.deals = new Map();
    this.BLOCK_SIZE = 1024 * 1024;
    this.listenPort = listenPort;
    this.storePath = storePath;
    this.fileEncryption = new FileEncryption();
  }

  async init() {
    this.node = await createLibp2p({
      addresses: {
        listen: [
          `/ip4/0.0.0.0/tcp/${this.listenPort}`,

        ],
        announce: [
          `/ip4/192.168.1.121/tcp/${this.listenPort}`,

        ],
      },
      transports: [tcp()],
      streamMuxers: [yamux()],
      connectionEncrypters: [noise()],

      services: {
        identify: identify(),
      },
      peerDiscovery: [ mdns({
        filter: (peerInfo) => {
          return !peerInfo.multiaddrs.some(addr =>
            addr.toString().includes("127.0.0.1") || addr.toString().includes("::1")
          );
        }
      })],
      nat: true,
      connectionManager: {
        minConnections: 0, // Réduire le minimum pour les tests
        maxConnections: 50,
        pollInterval: 2000,
        autoDialInterval: 2000,
        autoDial: false,
      },
      relay: {
        enabled: true,
        hop: {
          enabled: true,
          active: true,
        },
      },
    });
    this.BlockStorage = new BlockStorage(this.storePath);
    this.BlockStorage.init();

    this.DHT = new DHT(this.node, this.BlockStorage);
    this.BlockChain = new BlockChain(
      this.storePath + "/blockchain-db",
      this.DHT,
      this.node
    );
    this.BlockChain.initialize();
    this.DHT.start();
    //user manager
    this.DistributedUserIdentity = new DistributedUserIdentity(
      this.node,
      this.DHT,
      this.storePath
    );
    this.DistributedUserIdentity.start();
    this.shareSystem = new ShareSystem(this.BlockChain);
    this.wallet = {
      address: crypto.randomBytes(20).toString("hex"),
      balance: 1000, // Initial balance in FIL
    };

    this.node.addEventListener("peer:discovery", async (evt) => {
        const peerId = evt.detail.id;
        console.log(evt.detail)
  if (peerId.toString() === this.node.peerId.toString()) {
    console.log("Ignoring self connection via mdns discovery.");
    return;
  }

  // Filtrer les adresses pour n'utiliser que celles du réseau local
  const validMultiaddrs = evt.detail.multiaddrs.filter(addr =>
    addr.toString().includes("192.168.")  // ajuste si ton réseau local est différent
  );
  if (validMultiaddrs.length === 0) {
    console.log("No valid local addresses for peer:", peerId.toString());
    return;
  }

  try {
    await this.connectToPeer(validMultiaddrs[0].toString());
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
  convertBufferFormat(bufferJson) {
    if (
      bufferJson &&
      bufferJson.type === "Buffer" &&
      Array.isArray(bufferJson.data)
    ) {
      return Buffer.from(bufferJson.data);
    }
    return bufferJson;
  }
  async splitAndStoreFile(filePath, name, userId, privateKey, pubkey) {
    const fileContent = await fs.readFile(filePath);
    // const encryptedFile = await this.fileEncryption.encryptFile(
    //   fileContent,
    //   pubkey,
    //   privateKey
    // );

    const stats = await fs.stat(filePath);
    const hash = crypto.createHash("sha256").update(fileContent).digest("hex");
    const fileMetaData = new FileMetadata(name, stats.size, hash);
    const encryptionMeta = {};
    // const encryptionMeta = {
    //   iv: this.convertBufferFormat(encryptedFile.iv),
    //   authTag: this.convertBufferFormat(encryptedFile.authTag),
    //   protectedKey: {
    //     key: this.convertBufferFormat(encryptedFile.protectedKey.key),
    //     authTag: this.convertBufferFormat(encryptedFile.protectedKey.authTag),
    //   },
    //   signature: this.convertBufferFormat(encryptedFile.signature),
    //   salt: this.convertBufferFormat(encryptedFile.salt),
    // };
    const previousblock = await this.BlockChain.getLasteBlock();

    const newBlock = new BlockIteme(
      previousblock["index"] + 1,
      previousblock["hash"],
      fileMetaData,
      Date.now(),
      [],
      [],
      userId,
      encryptionMeta
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
    //test retrive file
    // await this.retrieveFile(newBlock.fileMetadata, newBlock.cids);
    // console.log(newBlock.hash);
    await this.BlockChain.addBlock(newBlock);

    // await this.shareFile(newBlock.hash, userId, "e243141514545bfqwet");
    // const result = await this.getSharedFiles(userId);
    // console.log(result);

    return blocks;
  }
  async storeBlock(block) {
    console.log("storeBlock called with CID:", block.cid.toString());
    console.log("Block value type:", typeof block.value);
    console.log("Block value:", block.value);

    await this.DHT.put(block.cid, block.value);

    return;
  }

  async retrieveAndSaveFile(
    fileHash,
    outputPath = null,
    publicKey,
    privateKey
  ) {
    try {
      console.log("Retrieving file with hash:", fileHash);
      const fileBlock = await this.BlockChain.getBlock(fileHash);

      const fileData = await this.retrieveFileByHash(
        fileBlock,
        publicKey,
        privateKey
      );
      if (!fileData) {
        console.log("File not found or corrupted");
        return null;
      }

      // Sauvegarder le fichier
      const savedPath = await this.saveRetrievedFile(fileData, outputPath);
      console.log(`File retrieved and saved to: ${savedPath}`);

      // return {
      //   path: savedPath,
      //   name: fileData.name,
      //   size: fileData.size,
      //   hash: fileData.hash,
      // };
      return savedPath;
    } catch (error) {
      console.error("Error retrieving and saving file:", error);
      throw error;
    }
  }

  async retrieveFileByHash(fileBlock, publicKey, privateKey) {
    try {
      console.log(fileBlock);
      const blockCids = fileBlock.cids.map((cid) => cid["/"]);
      const fileChunks = [];
      for (const cid of blockCids) {
        const blockData = await this.DHT.get(cid);
        if (!blockData) {
          console.error(`Failed to retrieve block with CID: ${cid}`);
          continue;
        }
        fileChunks.push(blockData);
      }

      if (fileChunks.length !== blockCids.length) {
        console.error("Some blocks are missing");
        return null;
      }

      const fileBuffer = Buffer.concat(
        fileChunks.map((chunk) => {
          if (typeof chunk === "string") {
            try {
              const parsed = JSON.parse(chunk);
              return Buffer.from(parsed);
            } catch {
              return Buffer.from(chunk);
            }
          }
          return Buffer.from(chunk);
        })
      );

      // const encryptionMeta = {
      //   iv: Buffer.from(fileBlock.encryptionMeta.iv.data),
      //   authTag: Buffer.from(fileBlock.encryptionMeta.authTag.data),
      //   protectedKey: {
      //     key: Buffer.from(fileBlock.encryptionMeta.protectedKey.key.data),
      //     authTag: Buffer.from(
      //       fileBlock.encryptionMeta.protectedKey.authTag.data
      //     ),fileBuffer
      //     iv: fileBlock.encryptionMeta.protectedKey.iv,
      //   },
      //   signature: Buffer.from(fileBlock.encryptionMeta.signature.data),
      //   salt: Buffer.from(fileBlock.encryptionMeta.salt.data),
      // };

      // const decryptedData = await this.fileEncryption.decryptFile(
      //   fileBuffer,
      //   encryptionMeta.iv,
      //   encryptionMeta.authTag,
      //   encryptionMeta.protectedKey,
      //   encryptionMeta.signature,
      //   encryptionMeta.salt,
      //   publicKey,
      //   privateKey
      // );

      // return {
      //   data: decryptedData,
      //   fileName: fileBlock.fileMetadata.name,
      // };

      return {
        data: fileBuffer,
        name: fileBlock.fileMetadata.name,
      };
    } catch (error) {
      console.error("Error retrieving file by hash:", error);
      throw error;
    }
  }

  async saveRetrievedFile(fileData, outputPath = "./out/") {
    try {
      const dataBuffer = Buffer.isBuffer(fileData.data)
        ? fileData.data
        : Buffer.from(fileData.data);

      const filePath = outputPath + fileData.name;
      await fs.writeFile(filePath, fileData.data);
      console.log(`File saved to: ${filePath}`);
      return filePath;
    } catch (error) {
      console.error("Error saving file:", error);
      throw error;
    }
  }
  async retrieveBlock(cid) {
    try {
      const value = await this.DHT.get(cid);
      return value;
    } catch {
      console.log("error .. ");
    }
  }

  async createUser(username) {
    return await this.DistributedUserIdentity.createUser(username);
  }

  async UserLogin(userId, privateKey) {
    return await this.DistributedUserIdentity.login(userId, privateKey);
  }

  async getUserFiles(userId) {
    return await this.BlockChain.getUserFiles(userId);
  }

  // Récupérer un fichier en vérifiant la propriété
  async retrieveUserFile(userId, fileHash) {
    try {
      // Vérifier la propriété
      const isOwner = await this.BlockChain.verifyFileOwnership(
        userId,
        fileHash
      );
      if (!isOwner) {
        throw new Error("Access denied: User does not own this file");
      }

      return await this.retrieveFile(fileHash);
    } catch (error) {
      console.error("Error retrieving user file:", error);
      throw error;
    }
  }

  async shareFile(fileHash, ownerUserId, targetUserId) {
    return this.shareSystem.shareFile(fileHash, ownerUserId, targetUserId);
  }

  async unshareFile(fileHash, ownerUserId, targetUserId) {
    return this.shareSystem.unshareFile(fileHash, ownerUserId, targetUserId);
  }

  async getSharedFiles(userId) {
    return this.shareSystem.getSharedFiles(userId);
  }

  async getFileSharedUsers(fileHash, ownerUserId) {
    return this.shareSystem.getFileSharedUsers(fileHash, ownerUserId);
  }

  async canAccessFile(fileHash, userId) {
    return this.shareSystem.canAccessFile(fileHash, userId);
  }
}

export { FilecoinNode };
