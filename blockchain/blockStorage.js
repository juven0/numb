import { Level } from "level";

class BlockStorage {
  constructor(dbPath) {
    this.db = new Level(dbPath, { valueEncoding: "json" });
  }

  async saveBlock(block) {
    try {
      // Sauvegarder le bloc
      await this.db.put(block.hash, block);

      // Mettre à jour l'index du dernier bloc
      await this.db.put("LAST_BLOCK_HASH", block.hash);
    } catch (error) {
      console.error("Error saving block:", error);
      throw error;
    }
  }

  async getBlock(hash) {
    try {
      return await this.db.get(hash);
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      throw error;
    }
  }

  async getLastBlockHash() {
    try {
      return await this.db.get("LAST_BLOCK_HASH");
    } catch (error) {
      if (error.notFound) {
        return null;
      }
      throw error;
    }
  }

  async getAllBlocks() {
    try {
      const blocks = [];
      // Utiliser la méthode values() au lieu d'un itérateur
      const values = await this.db.values().all();

      // Filtrer pour exclure l'entrée LAST_BLOCK_HASH
      for (const value of values) {
        if (value.hash) {
          // Vérifier que c'est bien un bloc
          blocks.push(value);
        }
      }

      // Trier les blocs par index
      blocks.sort((a, b) => a.index - b.index);
      return blocks;
    } catch (error) {
      console.error("Error getting all blocks:", error);
      throw error;
    }
  }

  async clear() {
    try {
      await this.db.clear();
    } catch (error) {
      console.error("Error clearing database:", error);
      throw error;
    }
  }

  async close() {
    try {
      await this.db.close();
    } catch (error) {
      console.error("Error closing database:", error);
      throw error;
    }
  }
}

export { BlockStorage };
