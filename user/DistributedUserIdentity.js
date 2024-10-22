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
      // Créer et ouvrir la base de données
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
    await this.db.open();
    await this.node.handle(this.usersTopic, this._handleUserSync.bind(this));
    await this.node.handle(
      this.validationTopic,
      this._handleUserValidation.bind(this)
    );

    await this._syncWithNetwork();
  }

  async createUser(username) {
    try {
      //   const existingUser = await this._checkUserExistsInNetwork(username);
      //   if (existingUser) {
      //     throw new Error("Username already exists in the network");
      //   }

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
        role: "user",
        isActive: true,
        nodeId: this.node.peerId.toString(),
        validations: [],
      };

      await this.db.put(userId, { ...user, privateKey });

      //wait for other peer

      //   await this._propagateUserToNetwork(user);

      //   const isValidated = await this._waitForNetworkValidation(userId);
      //   if (!isValidated) {
      //     await this.db.del(userId);
      //     throw new Error("User creation was not validated by the network");
      //   }

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
    const user = await this.getUser(userId);
    if (user != null) {
      return {
        userId: user.userId,
        username: user.username,
        publicKey: user.publicKey,
        credentials: this._generateCredentials(userId, privateKey),
      };
    } else {
      return null;
    }
  }

  async _handleUserSync({ stream }) {
    try {
      const message = await this._readStream(stream);
      const userData = JSON.parse(message);

      if (await this._verifyUserData(userData)) {
        await this._storeUserData(userData);
        await stream.sink([
          uint8ArrayFromString(JSON.stringify({ status: "success" })),
        ]);
      } else {
        await stream.sink([
          uint8ArrayFromString(JSON.stringify({ status: "invalid" })),
        ]);
      }
    } catch (error) {
      console.error("Error handling user sync:", error);
    } finally {
      await stream.close();
    }
  }

  async _handleUserValidation({ stream }) {
    try {
      const message = await this._readStream(stream);
      const { userId, validatorId, signature } = JSON.parse(message);

      if (await this._verifyValidation(userId, validatorId, signature)) {
        const user = await this.getUser(userId);
        if (user && !user.validations.includes(validatorId)) {
          user.validations.push(validatorId);
          await this.db.put(userId, user);
          await stream.sink([
            uint8ArrayFromString(JSON.stringify({ status: "validated" })),
          ]);
        }
      }
    } catch (error) {
      console.error("Error handling user validation:", error);
    } finally {
      await stream.close();
    }
  }

  async _propagateUserToNetwork(user) {
    const peers = await this.dht._findClosestPeers(user.userId);
    for (const peer of peers) {
      try {
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream(this.usersTopic);
        await stream.sink([uint8ArrayFromString(JSON.stringify(user))]);
        await stream.close();
      } catch (error) {
        console.error(`Failed to propagate user to peer ${peer.id}:`, error);
      }
    }
  }

  async _syncWithNetwork() {
    const peers = await this.dht._findClosestPeers(this.node.peerId.toString());
    for (const peer of peers) {
      try {
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream("/users/sync/1.0.0");
        const users = await this.db.values().all();
        await stream.sink([uint8ArrayFromString(JSON.stringify(users))]);
        await stream.close();
      } catch (error) {
        console.error(`Failed to sync with peer ${peer.id}:`, error);
      }
    }
  }

  async _readStream(stream) {
    let data = "";
    for await (const chunk of stream.source) {
      data += uint8ArrayToString(chunk.subarray());
    }
    return data;
  }

  _generateCredentials(userId, privateKey) {
    try {
      const token = {
        userId,
        timestamp: Date.now(),
        expiration: Date.now() + 24 * 60 * 60 * 1000, // 24 heures
      };

      const tokenString = JSON.stringify(token);

      const sign = crypto.createSign("SHA256");
      sign.update(tokenString);
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

      const verify = crypto.createVerify("SHA256");
      verify.update(token);
      return verify.verify(user.publicKey, signature, "hex");
    } catch (error) {
      console.error("Error verifying credentials:", error);
      return false;
    }
  }

  async getUser(userId) {
    try {
      const user = await this.db.get(userId);
      delete user.privateKey;
      return user;
    } catch (error) {
      return null;
    }
  }

  async _storeUserData(userData) {
    try {
      console.log("Storing user data:", userData.userId);

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

      // Ajouter à la DHT pour la réplication
      //   await this._storeUserInDHT(userData);

      return true;
    } catch (error) {
      console.error("Error storing user data:", error);
      return false;
    }
  }
}

export { DistributedUserIdentity };
