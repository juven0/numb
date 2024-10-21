import { concat as uint8ArrayConcat } from "uint8arrays/concat";
import { toString as uint8ArrayToString } from "uint8arrays/to-string";
import { fromString as uint8ArrayFromString } from "uint8arrays/from-string";

class DHT {
  constructor(node) {
    this.node = node;
    this.storage = new Map();
    this.chunkSize = 32 * 1024;
  }

  async start() {
    await this.node.handle("/simpledht/store", this._handleStore.bind(this));
    await this.node.handle("/simpledht/get", this._handleGet.bind(this));
    console.log("SimpleDHT started");
  }

  async _handleStore({ stream }) {
    console.log("_handleStore called");
    let chunks = [];
    try {
      for await (const chunk of stream.source) {
        console.log("Received chunk:", chunk);
        if (chunk instanceof Uint8Array) {
          chunks.push(chunk);
        } else if (chunk && chunk.bufs) {
          // Handle Uint8ArrayList
          chunks.push(...chunk.bufs);
        } else {
          console.warn("Received unexpected chunk type:", typeof chunk);
        }
      }
    } catch (error) {
      console.error("Error reading from stream:", error);
    }

    if (chunks.length === 0) {
      console.warn("No data received in _handleStore");
      await stream.close();
      return;
    }

    const fullData = uint8ArrayConcat(chunks);
    const stringData = uint8ArrayToString(fullData);
    console.log("Received data:", stringData);

    try {
      const { key, value, chunkIndex, totalChunks } = JSON.parse(stringData);

      if (!key || value === undefined) {
        console.warn("Received empty or invalid data");
        await stream.close();
        return;
      }

      if (!this.storage.has(key)) {
        this.storage.set(key, []);
      }

      const dataArray = this.storage.get(key);
      dataArray[chunkIndex] = value;

      if (dataArray.filter(Boolean).length === totalChunks) {
        const completeData = dataArray.join("");
        this.storage.set(key, completeData);
        console.log(`Stored complete data for key: ${key}`);
      } else {
        console.log(
          `Stored chunk ${chunkIndex + 1}/${totalChunks} for key: ${key}`
        );
      }
    } catch (error) {
      console.error("Error parsing incoming data:", error);
    }

    await stream.close();
  }

  async _handleGet({ stream }) {
    console.log("_handleGet called");
    let message;
    try {
      message = await stream.source.next();
    } catch (error) {
      console.error("Error reading from stream in _handleGet:", error);
      await stream.close();
      return;
    }

    if (!message || !message.value) {
      console.warn("No data received in _handleGet");
      await stream.close();
      return;
    }

    const key = uint8ArrayToString(message.value);
    console.log("Requested key:", key);
    const value = this.storage.get(key);

    if (value) {
      const chunks = this._chunkString(value);
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

    await stream.close();
  }

  async put(keyHash, data) {
    console.log("put called with keyHash:", keyHash);
    console.log("Data type:", typeof data);
    console.log("Data:", data);

    const stringData = this._ensureString(data);
    const chunks = this._chunkString(stringData);

    const closestPeers = await this._findClosestPeers(keyHash);

    for (const peer of closestPeers) {
      try {
        console.log("Attempting to dial peer:", peer.id.toString());
        const connection = await this.node.dial(peer.id);
        for (let i = 0; i < chunks.length; i++) {
          const stream = await connection.newStream("/simpledht/store");
          const chunkData = JSON.stringify({
            key: keyHash,
            value: chunks[i],
            chunkIndex: i,
            totalChunks: chunks.length,
          });
          await stream.sink([uint8ArrayFromString(chunkData)]);
          await stream.close();
        }
        console.log("Successfully stored data on peer:", peer.id.toString());
      } catch (err) {
        console.error(`Failed to store on peer ${peer.id.toString()}:`, err);
      }
    }
  }

  async get(key) {
    console.log("get called with key:", key);
    const closestPeers = await this._findClosestPeers(key);

    for (const peer of closestPeers) {
      try {
        console.log("Attempting to dial peer:", peer.id.toString());
        const connection = await this.node.dial(peer.id);
        const stream = await connection.newStream("/simpledht/get");
        await stream.sink([uint8ArrayFromString(key)]);

        let chunks = [];
        let totalChunks = null;

        for await (const chunk of stream.source) {
          console.log("Received chunk in get:", chunk);
          const decodedChunk = uint8ArrayToString(
            chunk instanceof Uint8Array ? chunk : uint8ArrayConcat(chunk.bufs)
          );
          const {
            value,
            chunkIndex,
            totalChunks: total,
          } = JSON.parse(decodedChunk);
          if (value === null) break;

          chunks[chunkIndex] = value;
          totalChunks = total;

          if (chunks.filter(Boolean).length === totalChunks) {
            await stream.close();
            return chunks.join("");
          }
        }

        await stream.close();
      } catch (err) {
        console.error(`Failed to get from peer ${peer.id.toString()}:`, err);
      }
    }

    return null;
  }

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
