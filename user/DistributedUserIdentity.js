import crypto from "crypto";
import { generateKeyPairSync } from "crypto";
import { Level } from "level";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";

class DistributedUserIdentity {
  constructor(node, dht, dbPath = "./users-db") {
    this.node = node;
    this.dht = dht;
    this.db = null;
    this.dbPath = dbPath;
    this.isInitialized = false;
    this.usersTopic = "/users/1.0.0";
    this.validationTopic = "/users/validate/1.0.0";
  }

  async init() {
    try {
      this.db = new Level(this.dbPath, { valueEncoding: "json" });
      await this.db.open();
      this.isInitialized = true;
      console.log("Database initialized successfully");
    } catch (error) {
      console.error("Error initializing database:", error);
      throw error;
    }
  }

  async start() {
    if (!this.isInitialized) {
      await this.init();
    }

    // Enregistrer les gestionnaires de protocole
    await this.node.handle(
      "/users/sync-summary",
      this._handleSyncSummary.bind(this)
    );
    await this.node.handle("/users/fetch", this._handleFetchUsers.bind(this));
    await this.node.handle("/users/send", this._handleReceiveUsers.bind(this));
    await this.node.handle(
      this.validationTopic,
      this._handleUserValidation.bind(this)
    );

    // Démarrer la synchronisation périodique
    setInterval(() => this._syncWithNetwork(), 30000);
    console.log("DistributedUserIdentity started");
  }

  async createUser(username) {
    try {
      const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
        publicKeyEncoding: { type: "spki", format: "pem" },
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
      });

      const userId = crypto
        .createHash("sha256")
        .update(publicKey)
        .digest("hex")
        .substring(0, 16);

      const user = {
        userId,
        username,
        publicKey,
        createdAt: Date.now(),
        lastUpdated: Date.now(),
        role: "user",
        isActive: true,
        nodeId: this.node.peerId.toString(),
        validations: [],
      };

      await this.db.put(userId, { ...user, privateKey });

      return {
        userId,
        username,
        publicKey,
        privateKey,
        credentials: this._generateCredentials(userId, privateKey),
      };
    } catch (error) {
      console.error("Error creating distributed user:", error);
      throw error;
    }
  }

  async login(userId, privateKey) {
    try {
      const user = await this.getUser(userId);
      if (user) {
        return {
          userId: user.userId,
          username: user.username,
          publicKey: user.publicKey,
          credentials: this._generateCredentials(userId, privateKey),
        };
      }
      return null;
    } catch (error) {
      console.error("Error during login:", error);
      return null;
    }
  }

  async _syncWithNetwork() {
    try {
      const peers = await this.dht._findClosestPeers(
        this.node.peerId.toString()
      );
      console.log("Found peers for sync:", peers.length);

      const localUsers = await this._getUserSummaries();

      for (const peer of peers) {
        try {
          console.log("Syncing with peer:", peer.id.toString());
          const connection = await this.node.dial(peer.id);

          // Échanger les résumés
          const stream = await connection.newStream("/users/sync-summary");
          await stream.sink([uint8ArrayFromString(JSON.stringify(localUsers))]);

          const peerSummaryData = await this._readStream(stream);
          const peerUsers = JSON.parse(peerSummaryData);

          const { toFetch, toSend } = this._compareUserSummaries(
            localUsers,
            peerUsers
          );

          // Échanger les utilisateurs manquants
          if (toFetch.length > 0) {
            await this._fetchMissingUsers(peer, toFetch);
          }
          if (toSend.length > 0) {
            await this._sendMissingUsers(peer, toSend);
          }

          await stream.close();
        } catch (error) {
          console.error(
            `Failed to sync with peer ${peer.id.toString()}:`,
            error
          );
        }
      }
    } catch (error) {
      console.error("Error in network synchronization:", error);
    }
  }

  async _getUserSummaries() {
    try {
      const users = await this.db.values().all();
      return users.map((user) => ({
        userId: user.userId,
        lastUpdated: user.lastUpdated || user.createdAt,
        validations: user.validations?.length || 0,
      }));
    } catch (error) {
      console.error("Error getting user summaries:", error);
      return [];
    }
  }

  _compareUserSummaries(localUsers, peerUsers) {
    const toFetch = [];
    const toSend = [];

    const localMap = new Map(localUsers.map((u) => [u.userId, u]));
    const peerMap = new Map(peerUsers.map((u) => [u.userId, u]));

    for (const peerUser of peerUsers) {
      const localUser = localMap.get(peerUser.userId);
      if (
        !localUser ||
        localUser.lastUpdated < peerUser.lastUpdated ||
        localUser.validations < peerUser.validations
      ) {
        toFetch.push(peerUser.userId);
      }
    }

    for (const localUser of localUsers) {
      const peerUser = peerMap.get(localUser.userId);
      if (
        !peerUser ||
        peerUser.lastUpdated < localUser.lastUpdated ||
        peerUser.validations < localUser.validations
      ) {
        toSend.push(localUser.userId);
      }
    }

    return { toFetch, toSend };
  }

  async _handleSyncSummary({ stream }) {
    try {
      const summaryData = await this._readStream(stream);
      const peerSummary = JSON.parse(summaryData);

      const localSummary = await this._getUserSummaries();
      await stream.sink([uint8ArrayFromString(JSON.stringify(localSummary))]);

      await stream.close();
    } catch (error) {
      console.error("Error handling sync summary:", error);
    }
  }

  async _handleFetchUsers({ stream }) {
    try {
      const request = await this._readStream(stream);
      const { userIds } = JSON.parse(request);

      const users = await Promise.all(
        userIds.map((userId) => this.getUser(userId))
      );

      await stream.sink([uint8ArrayFromString(JSON.stringify(users))]);
      await stream.close();
    } catch (error) {
      console.error("Error handling fetch users:", error);
    }
  }

  async _handleReceiveUsers({ stream }) {
    try {
      const userData = await this._readStream(stream);
      const users = JSON.parse(userData);

      for (const user of users) {
        if (await this._verifyUserData(user)) {
          await this._storeUserData(user);
        }
      }

      await stream.close();
    } catch (error) {
      console.error("Error handling receive users:", error);
    }
  }

  _generateCredentials(userId, privateKey) {
    try {
      const token = {
        userId,
        timestamp: Date.now(),
        expiration: Date.now() + 24 * 60 * 60 * 1000, // 24 heures
      };

      const tokenString = JSON.stringify(token);
      const signature = crypto.sign(null, Buffer.from(tokenString), privateKey);

      return {
        token: tokenString,
        signature: signature.toString("hex"),
        expiration: token.expiration,
      };
    } catch (error) {
      console.error("Error generating credentials:", error);
      throw error;
    }
  }

  async verifyCredentials(userId, token, signature) {
    try {
      const user = await this.getUser(userId);
      if (!user) return false;

      return crypto.verify(
        null,
        Buffer.from(token),
        user.publicKey,
        Buffer.from(signature, "hex")
      );
    } catch (error) {
      console.error("Error verifying credentials:", error);
      return false;
    }
  }

  async getUser(userId) {
    try {
      const user = await this.db.get(userId);
      const publicUser = { ...user };
      delete publicUser.privateKey;
      return publicUser;
    } catch (error) {
      return null;
    }
  }

  async _storeUserData(userData) {
    try {
      const existingUser = await this.getUser(userData.userId);
      if (existingUser) {
        const updatedUser = {
          ...existingUser,
          ...userData,
          lastUpdated: Date.now(),
        };
        await this.db.put(userData.userId, updatedUser);
        console.log("Updated existing user:", userData.userId);
      } else {
        const newUser = {
          ...userData,
          createdAt: Date.now(),
          lastUpdated: Date.now(),
        };
        await this.db.put(userData.userId, newUser);
        console.log("Stored new user:", userData.userId);
      }

      return true;
    } catch (error) {
      console.error("Error storing user data:", error);
      return false;
    }
  }

  async _verifyUserData(userData) {
    try {
      if (!userData || typeof userData !== "object") {
        return false;
      }

      const requiredFields = [
        "userId",
        "username",
        "publicKey",
        "createdAt",
        "nodeId",
      ];
      for (const field of requiredFields) {
        if (!userData[field]) {
          return false;
        }
      }

      if (
        typeof userData.userId !== "string" ||
        userData.userId.length !== 16
      ) {
        return false;
      }

      if (!userData.publicKey.includes("BEGIN PUBLIC KEY")) {
        return false;
      }

      if (!Number.isInteger(userData.createdAt) || userData.createdAt <= 0) {
        return false;
      }

      if (
        typeof userData.nodeId !== "string" ||
        !userData.nodeId.startsWith("12D3")
      ) {
        return false;
      }

      if (userData.validations && !Array.isArray(userData.validations)) {
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error in _verifyUserData:", error);
      return false;
    }
  }

  async _handleUserValidation({ stream }) {
    try {
      const message = await this._readStream(stream);
      const { userId, validatorId, signature } = JSON.parse(message);

      const user = await this.getUser(userId);
      if (user && !user.validations.includes(validatorId)) {
        user.validations.push(validatorId);
        await this.db.put(userId, user);
        await stream.sink([
          uint8ArrayFromString(JSON.stringify({ status: "validated" })),
        ]);
      }
    } catch (error) {
      console.error("Error handling user validation:", error);
    } finally {
      await stream.close();
    }
  }

  async _readStream(stream) {
    let data = "";
    for await (const chunk of stream.source) {
      data += uint8ArrayToString(chunk.subarray());
    }
    return data;
  }

  // Ajoutez ces méthodes dans votre classe DistributedUserIdentity

  async _fetchMissingUsers(peer, userIds) {
    try {
      console.log(
        `Fetching ${
          userIds.length
        } missing users from peer ${peer.id.toString()}`
      );
      const connection = await this.node.dial(peer.id);
      const stream = await connection.newStream("/users/fetch");

      // Demander les utilisateurs
      await stream.sink([uint8ArrayFromString(JSON.stringify({ userIds }))]);

      // Recevoir les utilisateurs
      const userData = await this._readStream(stream);
      const users = JSON.parse(userData);

      console.log(`Received ${users.length} users from peer`);

      // Stocker les utilisateurs reçus
      for (const user of users) {
        if (await this._verifyUserData(user)) {
          await this._storeUserData(user);
          console.log(`Stored user ${user.userId} from peer`);
        } else {
          console.log(`Invalid user data received for ${user.userId}`);
        }
      }

      await stream.close();
    } catch (error) {
      console.error("Error fetching missing users:", error);
    }
  }

  async _sendMissingUsers(peer, userIds) {
    try {
      console.log(
        `Sending ${userIds.length} users to peer ${peer.id.toString()}`
      );
      const connection = await this.node.dial(peer.id);
      const stream = await connection.newStream("/users/send");

      // Obtenir les données des utilisateurs
      const users = await Promise.all(
        userIds.map(async (userId) => {
          const user = await this.getUser(userId);
          if (user) {
            // S'assurer que la clé privée n'est pas envoyée
            const { privateKey, ...publicUserData } = user;
            return publicUserData;
          }
          return null;
        })
      );

      // Filtrer les utilisateurs null
      const validUsers = users.filter((user) => user !== null);
      console.log(`Sending ${validUsers.length} valid users to peer`);

      // Envoyer les utilisateurs
      await stream.sink([uint8ArrayFromString(JSON.stringify(validUsers))]);
      await stream.close();

      console.log("Successfully sent users to peer");
    } catch (error) {
      console.error("Error sending missing users:", error);
    }
  }

  // Vous pouvez aussi ajouter cette méthode utilitaire pour la journalisation
  _logPeerOperation(operation, peerId, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${operation} with peer ${peerId}: ${message}`);
  }
}

export { DistributedUserIdentity };
