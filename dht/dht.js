import { concat as uint8ArrayConcat } from "uint8arrays/concat";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";

class DHT {
  constructor(node, BlockStorage) {
    this.node = node;
    this.storage = BlockStorage;
    this.chunkSize = 32 * 1024;
    this.tempStorage = new Map();
    this.chunkTracker = new Map();
  }

  async start() {
    try {
      await this.storage.init();
      await this.node.handle("/simpledht/store", this._handleStore.bind(this));
      await this.node.handle("/simpledht/get", this._handleGet.bind(this));
      console.log("SimpleDHT started with persistent storage");
    } catch (error) {
      console.error("Error starting DHT:", error);
      throw error;
    }
  }

  async _handleStore({ stream }) {
    console.log("_handleStore called");
    try {
      const message = await this._readStreamMessage(stream);
      const { key, value, chunkIndex, totalChunks } = message;

      // Convertir la clé en chaîne
      const keyString = this._normalizeKey(key);
      console.log("Processing chunk for key:", keyString);

      // Initialiser le tracking pour cette clé
      if (!this.chunkTracker.has(keyString)) {
        this.chunkTracker.set(keyString, {
          totalExpected: totalChunks,
          received: new Map(),
        });
      }

      const tracker = this.chunkTracker.get(keyString);
      tracker.received.set(parseInt(chunkIndex), value);

      console.log(`Stored chunk ${chunkIndex + 1}/${totalChunks}`);
      console.log(
        `Current chunks: ${tracker.received.size}/${tracker.totalExpected}`
      );

      // Vérifier si tous les chunks sont reçus
      if (tracker.received.size === tracker.totalExpected) {
        console.log("All chunks received, assembling data...");

        // Assembler les chunks dans l'ordre
        const orderedData = [];
        for (let i = 0; i < totalChunks; i++) {
          const chunk = tracker.received.get(i);
          if (chunk === undefined) {
            console.warn(`Missing chunk at index ${i}`);
            return;
          }
          orderedData.push(chunk);
        }

        const completeData = orderedData.join("");
        console.log(`Assembled data length: ${completeData.length}`);

        // Stocker les données complètes
        await this.storage.storeBlock(keyString, completeData);

        // Nettoyer le tracker
        this.chunkTracker.delete(keyString);

        console.log(`Successfully stored complete data for key: ${keyString}`);
      } else {
        console.log(
          `Waiting for more chunks: ${tracker.received.size}/${tracker.totalExpected}`
        );
      }
    } catch (error) {
      console.error("Error handling store:", error);
      console.error("Stack trace:", error.stack);
    } finally {
      await stream.close();
    }
  }

  async _readStreamMessage(stream) {
    let chunks = [];
    for await (const chunk of stream.source) {
      if (chunk instanceof Uint8Array) {
        chunks.push(chunk);
      } else if (chunk && chunk.bufs) {
        chunks.push(...chunk.bufs);
      }
    }

    const fullData = uint8ArrayConcat(chunks);
    const stringData = uint8ArrayToString(fullData);
    return JSON.parse(stringData);
  }

  async _handleGet({ stream }) {
    try {
      const message = await stream.source.next();
      if (!message || !message.value) {
        console.warn("No data received in _handleGet");
        return;
      }

      const keyBuffer = Buffer.concat(message.value.bufs);
      const key = keyBuffer.toString("utf8");
      console.log("Requested key:", key);

      // Récupérer les données depuis BlockStorage
      const value = await this.storage.getBlock(key);

      if (value) {
        const valueString = value.toString();
        const chunks = this._chunkString(valueString);

        for (let i = 0; i < chunks.length; i++) {
          await stream.sink([
            uint8ArrayFromString(
              JSON.stringify({
                value: chunks[i],
                chunkIndex: i,
                totalChunks: chunks.length,
              })
            ),
          ]);
        }
      } else {
        await stream.sink([
          uint8ArrayFromString(JSON.stringify({ value: null })),
        ]);
      }
    } catch (error) {
      console.error("Error handling get:", error);
    } finally {
      await stream.close();
    }
  }

  _normalizeKey(key) {
    if (typeof key === "string") return key;
    if (key && key["/"]) return key["/"];
    if (typeof key === "object") return JSON.stringify(key);
    return String(key);
  }

  async _handleGet({ stream }) {
    let isStreamOpen = true;

    try {
      const message = await stream.source.next();
      if (!message || !message.value) {
        console.warn("No data received in _handleGet");
        return;
      }

      const keyBuffer = Buffer.concat(message.value.bufs);
      const key = keyBuffer.toString("utf8");
      const normalizedKey = this._normalizeKey(key);

      console.log("Requested key:", normalizedKey);

      const value = await this.storage.getBlock(normalizedKey);

      if (value && isStreamOpen) {
        const valueString = value.toString();
        const chunks = this._chunkString(valueString, 1024); // Réduire la taille des chunks
        console.log(`Preparing to send ${chunks.length} chunks`);

        // Créer un seul gros message avec tous les chunks
        const fullMessage = {
          type: "full_response",
          chunks: chunks.map((chunk, index) => ({
            value: chunk,
            index: index,
          })),
          totalChunks: chunks.length,
        };

        // Envoyer tout en une fois
        if (isStreamOpen) {
          await stream.sink([
            uint8ArrayFromString(JSON.stringify(fullMessage)),
          ]);
          console.log("Successfully sent all chunks in one message");
        }
      } else {
        if (isStreamOpen) {
          await stream.sink([
            uint8ArrayFromString(
              JSON.stringify({
                type: "error",
                message: "Data not found",
              })
            ),
          ]);
        }
      }
    } catch (error) {
      console.error("Error handling get:", error);
    } finally {
      isStreamOpen = false;
      try {
        await stream.close();
      } catch (closeError) {
        console.error("Error closing stream:", closeError);
      }
    }
  }

  async put(keyHash, data) {
    console.log("put called with keyHash:", keyHash);

    const normalizedKey = this._normalizeKey(keyHash);
    const stringData = this._ensureString(data);
    const chunks = this._chunkString(stringData);

    console.log(
      `Preparing to send ${chunks.length} chunks for key ${normalizedKey}`
    );

    const closestPeers = await this._findClosestPeers(normalizedKey);

    // Stocker localement aussi

    await this.storage.storeBlock(keyHash, stringData);

    for (const peer of closestPeers) {
      try {
        const connection = await this.node.dial(peer.id);

        for (let i = 0; i < chunks.length; i++) {
          const stream = await connection.newStream("/simpledht/store");
          const chunkData = {
            key: keyHash, // garder le format original pour la compatibilité
            value: chunks[i],
            chunkIndex: i,
            totalChunks: chunks.length,
          };

          await stream.sink([uint8ArrayFromString(JSON.stringify(chunkData))]);
          console.log(
            `Sent chunk ${i + 1}/${chunks.length} to peer ${peer.id.toString()}`
          );
          await stream.close();
        }
      } catch (err) {
        console.error(`Failed to store on peer ${peer.id.toString()}:`, err);
      }
    }
  }
  async get(key) {
    console.log("get called with key:", key);
    const normalizedKey = this._normalizeKey(key);

    try {
      const localData = await this.storage.getBlock(normalizedKey);
      if (localData) {
        console.log("Data found locally");
        return localData.toString();
      }

      console.log("Data not found locally, trying peers");
      const closestPeers = await this._findClosestPeers(normalizedKey);

      for (const peer of closestPeers) {
        try {
          console.log("Attempting to dial peer:", peer.id.toString());
          const connection = await this.node.dial(peer.id);
          const stream = await connection.newStream("/simpledht/get");

          await stream.sink([uint8ArrayFromString(normalizedKey)]);

          const response = await this._readStreamResponse(stream);
          if (!response) {
            console.log("No response from peer");
            continue;
          }

          if (response.type === "full_response") {
            // Reconstituer les données à partir des chunks
            const orderedChunks = response.chunks
              .sort((a, b) => a.index - b.index)
              .map((chunk) => chunk.value);

            const completeData = orderedChunks.join("");

            // Stocker localement
            await this.storage.storeBlock(normalizedKey, completeData);

            await stream.close();
            return completeData;
          }

          await stream.close();
        } catch (err) {
          console.error(`Failed to get from peer ${peer.id.toString()}:`, err);
        }
      }

      return null;
    } catch (error) {
      console.error("Error in get:", error);
      throw error;
    }
  }

  async _readStreamResponse(stream) {
    try {
      const message = await stream.source.next();
      if (!message || !message.value || message.done) return null;

      const value = message.value;
      const decodedData = uint8ArrayToString(
        value instanceof Uint8Array ? value : uint8ArrayConcat(value.bufs)
      );

      return JSON.parse(decodedData);
    } catch (error) {
      console.error("Error reading stream response:", error);
      return null;
    }
  }

  _chunkString(str, size = 1024) {
    if (typeof str !== "string") {
      str = str.toString();
    }
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  }
  // async _readStreamResponse(stream) {
  //   try {
  //     const message = await stream.source.next();
  //     if (!message || !message.value) return null;

  //     const value = message.value;
  //     const decodedData = uint8ArrayToString(
  //       value instanceof Uint8Array ? value : uint8ArrayConcat(value.bufs)
  //     );
  //     console.log(decodedData);
  //     return JSON.parse(decodedData);
  //   } catch (error) {
  //     console.error("Error reading stream response:", error);
  //     return null;
  //   }
  // }
  _chunkString(str, size = this.chunkSize) {
    if (typeof str !== "string") {
      str = str.toString();
    }
    const chunks = [];
    for (let i = 0; i < str.length; i += size) {
      chunks.push(str.slice(i, i + size));
    }
    return chunks;
  }
  // constructor(node) {
  //   this.node = node;
  //   this.storage = new Map();
  //   this.chunkSize = 32 * 1024;
  // }

  // async start() {
  //   await this.node.handle("/simpledht/store", this._handleStore.bind(this));
  //   await this.node.handle("/simpledht/get", this._handleGet.bind(this));
  //   console.log("SimpleDHT started");
  // }

  // async _handleStore({ stream }) {
  //   console.log("_handleStore called");
  //   let chunks = [];
  //   try {
  //     for await (const chunk of stream.source) {
  //       console.log("Received chunk:", chunk);
  //       if (chunk instanceof Uint8Array) {
  //         chunks.push(chunk);
  //       } else if (chunk && chunk.bufs) {
  //         // Handle Uint8ArrayList
  //         chunks.push(...chunk.bufs);
  //       } else {
  //         console.warn("Received unexpected chunk type:", typeof chunk);
  //       }
  //     }
  //   } catch (error) {
  //     console.error("Error reading from stream:", error);
  //   }

  //   if (chunks.length === 0) {
  //     console.warn("No data received in _handleStore");
  //     await stream.close();
  //     return;
  //   }

  //   const fullData = uint8ArrayConcat(chunks);
  //   const stringData = uint8ArrayToString(fullData);

  //   try {
  //     const { key, value, chunkIndex, totalChunks } = JSON.parse(stringData);

  //     if (!key || value === undefined) {
  //       console.warn("Received empty or invalid data");
  //       await stream.close();
  //       return;
  //     }

  //     if (!this.storage.has(key)) {
  //       this.storage.set(key, []);
  //     }

  //     const dataArray = this.storage.get(key);
  //     dataArray[chunkIndex] = value;

  //     if (dataArray.filter(Boolean).length === totalChunks) {
  //       const completeData = dataArray.join("");
  //       console.log("key for storage =>" + key);
  //       this.storage.set(key.toString("utf8"), completeData);
  //       console.log(`Stored complete data for key: ${key.toString("utf8")}`);
  //     } else {
  //       // console.log(
  //       //   `Stored chunk ${
  //       //     chunkIndex + 1
  //       //   }/${totalChunks} for key: ${key.toString("utf8")}`
  //       // );
  //     }
  //   } catch (error) {
  //     console.error("Error parsing incoming data:", error);
  //   }
  //   console.log(this.storage.keys().next().value);
  //   await stream.close();
  // }

  // async _handleGet({ stream }) {
  //   console.log("_handleGet called");
  //   let message;
  //   try {
  //     message = await stream.source.next();
  //     console.log(message);
  //   } catch (error) {
  //     console.error("Error reading from stream in _handleGet:", error);
  //     await stream.close();
  //     return;
  //   }

  //   if (!message || !message.value) {
  //     console.warn("No data received in _handleGet");
  //     await stream.close();
  //     return;
  //   }
  //   const keyBuffer = Buffer.concat(message.value.bufs);
  //   const key = keyBuffer.toString("utf8");

  //   console.log("Requested key:", key);
  //   const value = this.storage.get(key);

  //   if (value) {
  //     const chunks = this._chunkString(value);
  //     for (let i = 0; i < chunks.length; i++) {
  //       await stream.sink([
  //         uint8ArrayFromString(
  //           JSON.stringify({
  //             value: chunks[i],
  //             chunkIndex: i,
  //             totalChunks: chunks.length,
  //           })
  //         ),
  //       ]);
  //     }
  //   } else {
  //     await stream.sink([
  //       uint8ArrayFromString(JSON.stringify({ value: null })),
  //     ]);
  //   }

  //   await stream.close();
  // }

  // async put(keyHash, data) {
  //   console.log("put called with keyHash:", keyHash);
  //   console.log("Data type:", typeof data);
  //   console.log("Data:", data);

  //   const stringData = this._ensureString(data);
  //   const chunks = this._chunkString(stringData);

  //   const closestPeers = await this._findClosestPeers(keyHash);

  //   for (const peer of closestPeers) {
  //     try {
  //       console.log("Attempting to dial peer:", peer.id.toString());
  //       const connection = await this.node.dial(peer.id);
  //       for (let i = 0; i < chunks.length; i++) {
  //         const stream = await connection.newStream("/simpledht/store");
  //         const chunkData = JSON.stringify({
  //           key: keyHash,
  //           value: chunks[i],
  //           chunkIndex: i,
  //           totalChunks: chunks.length,
  //         });
  //         await stream.sink([uint8ArrayFromString(chunkData)]);
  //         await stream.close();
  //       }
  //       console.log("Successfully stored data on peer:", peer.id.toString());
  //     } catch (err) {
  //       console.error(`Failed to store on peer ${peer.id.toString()}:`, err);
  //     }
  //   }
  // }

  // async get(key) {
  //   console.log("get called with key:", key);

  //   const closestPeers = await this._findClosestPeers(key);

  //   for (const peer of closestPeers) {
  //     try {
  //       console.log("Attempting to dial peer:", peer.id.toString());
  //       console.log(typeof key);
  //       const connection = await this.node.dial(peer.id);
  //       const stream = await connection.newStream("/simpledht/get");
  //       await stream.sink([uint8ArrayFromString(key.toString())]);

  //       let chunks = [];
  //       let totalChunks = null;

  //       for await (const chunk of stream.source) {
  //         const decodedChunk = uint8ArrayToString(
  //           chunk instanceof Uint8Array ? chunk : uint8ArrayConcat(chunk.bufs)
  //         );
  //         const {
  //           value,
  //           chunkIndex,
  //           totalChunks: total,
  //         } = JSON.parse(decodedChunk);
  //         if (value === null) break;

  //         chunks[chunkIndex] = value;
  //         totalChunks = total;

  //         if (chunks.filter(Boolean).length === totalChunks) {
  //           await stream.close();
  //           console.log(chunks.join(""));
  //         }
  //       }

  //       await stream.close();
  //     } catch (err) {
  //       console.error(`Failed to get from peer ${peer.id.toString()}:`, err);
  //     }
  //   }

  //   return null;
  // }

  async _findClosestPeers(keyHash) {
    const peers = await this.node.peerStore.all();
    console.log(
      "Found peers:",
      peers.map((p) => p.id.toString())
    );
    return peers;
  }

  _chunkString(str, size = this.chunkSize) {
    if (typeof str !== "string") {
      console.warn("_chunkString received non-string data:", str);
      return [String(str)];
    }
    return str.match(new RegExp(`.{1,${size}}`, "g")) || [];
  }

  _ensureString(data) {
    if (typeof data === "string") {
      return data;
    }
    if (data && typeof data === "object") {
      return JSON.stringify(data);
    }
    return String(data);
  }
}

export { DHT };
