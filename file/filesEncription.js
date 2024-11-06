import crypto from "crypto";

class FileEncryption {
  constructor() {
    this.algorithm = "aes-256-gcm";
    this.keyLength = 32;
    this.ivLength = 12;
    this.saltLength = 16;
    this.tagLength = 16;
  }

  async encryptFile(fileData, publicKey, privateKey) {
    try {
      // Ensure fileData is a Buffer
      const fileBuffer = Buffer.isBuffer(fileData)
        ? fileData
        : Buffer.from(fileData);

      // Generate encryption keys and IV
      const aesKey = crypto.randomBytes(32);
      const iv = crypto.randomBytes(12);

      // Encrypt file with AES-GCM
      const cipher = crypto.createCipheriv("aes-256-gcm", aesKey, iv);
      let encryptedData = cipher.update(fileBuffer);
      encryptedData = Buffer.concat([encryptedData, cipher.final()]);
      const authTag = cipher.getAuthTag();

      // Protect AES key
      const keyProtection = this._deriveKeyProtection(privateKey);
      const protectedAesKey = this._encryptAesKey(aesKey, keyProtection);

      // Sign the encrypted data and metadata
      const signaturePayload = this._createSignaturePayload(
        encryptedData,
        iv,
        authTag
      );
      const signature = crypto.sign(null, signaturePayload, privateKey);

      return {
        encryptedData: encryptedData,
        iv: iv,
        authTag: authTag,
        protectedKey: protectedAesKey,
        signature: signature,
        salt: keyProtection.salt,
      };
    } catch (error) {
      console.error("Encryption error:", error);
      throw error;
    }
  }

  _createSignaturePayload(encryptedData, iv, authTag) {
    // Create a standardized format for the signature payload
    const payload = {
      encryptedData: encryptedData.toString("hex"),
      iv: iv.toString("hex"),
      authTag: authTag.toString("hex"),
    };
    return Buffer.from(JSON.stringify(payload));
  }

  _verifySignaturePayload(encryptedData, iv, authTag, signature, publicKey) {
    try {
      // Recreate the signature payload in the same format
      const signaturePayload = this._createSignaturePayload(
        encryptedData,
        iv,
        authTag
      );

      // Log verification details
      console.log("Verification details:");
      console.log("Payload length:", signaturePayload.length);
      console.log("Signature length:", signature.length);

      // Verify signature
      return crypto.verify(null, signaturePayload, publicKey, signature);
    } catch (error) {
      console.error("Signature verification error:", error);
      return false;
    }
  }

  async decryptFile(
    encryptedData,
    iv,
    authTag,
    protectedKey,
    signature,
    salt,
    publicKey,
    privateKey
  ) {
    try {
      // Ensure all inputs are Buffers
      const encryptedBuffer = Buffer.isBuffer(encryptedData)
        ? encryptedData
        : Buffer.from(encryptedData);
      const ivBuffer = Buffer.isBuffer(iv) ? iv : Buffer.from(iv.data);
      const authTagBuffer = Buffer.isBuffer(authTag)
        ? authTag
        : Buffer.from(authTag.data);
      const signatureBuffer = Buffer.isBuffer(signature)
        ? signature
        : Buffer.from(signature.data);
      const saltBuffer = Buffer.isBuffer(salt) ? salt : Buffer.from(salt.data);

      // Verify signature using the standardized payload format
      const isValid = this._verifySignaturePayload(
        encryptedBuffer,
        ivBuffer,
        authTagBuffer,
        signatureBuffer,
        publicKey
      );

      if (!isValid) {
        throw new Error("Invalid file signature");
      }

      // Decrypt AES key
      const keyProtection = this._deriveKeyProtection(privateKey, saltBuffer);
      const aesKey = this._decryptAesKey(protectedKey, keyProtection);

      // Decrypt file
      const decipher = crypto.createDecipheriv("aes-256-gcm", aesKey, ivBuffer);
      decipher.setAuthTag(authTagBuffer);
      let decryptedData = decipher.update(encryptedBuffer);
      decryptedData = Buffer.concat([decryptedData, decipher.final()]);

      return decryptedData;
    } catch (error) {
      console.error("Decryption error:", error);
      throw error;
    }
  }

  _deriveKeyProtection(privateKey, existingSalt = null) {
    const salt = existingSalt || crypto.randomBytes(16);
    const derivedKey = crypto.pbkdf2Sync(
      privateKey,
      salt,
      100000,
      32,
      "sha256"
    );

    return {
      key: derivedKey,
      salt: salt,
    };
  }

  _encryptAesKey(aesKey, keyProtection) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", keyProtection.key, iv);
    let encryptedKey = cipher.update(aesKey);
    encryptedKey = Buffer.concat([encryptedKey, cipher.final()]);
    const keyAuthTag = cipher.getAuthTag();

    return {
      key: encryptedKey,
      authTag: keyAuthTag,
      iv: iv,
    };
  }

  _decryptAesKey(protectedKey, keyProtection) {
    const keyIv = protectedKey.iv || crypto.randomBytes(12);
    const decipher = crypto.createDecipheriv(
      "aes-256-gcm",
      keyProtection.key,
      keyIv
    );
    decipher.setAuthTag(protectedKey.authTag);
    let decryptedKey = decipher.update(protectedKey.key);
    decryptedKey = Buffer.concat([decryptedKey, decipher.final()]);
    return decryptedKey;
  }
}

export { FileEncryption };
