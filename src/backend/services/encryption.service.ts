import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

const ALGORITHM = "aes-256-cbc";
const SALT = "MCP_ENCRYPTION_SALT_2024"; // Static salt for deriving consistent keys

export interface EncryptionService {
  encrypt(plaintext: string): { encryptedData: string; iv: string };
  decrypt(encryptedData: string, iv: string): string;
}

export function createEncryptionService(encryptionKey: string): EncryptionService {
  // Derive a 256-bit key from the provided string
  const derivedKey = scryptSync(encryptionKey, SALT, 32);

  return {
    encrypt(plaintext: string): { encryptedData: string; iv: string } {
      // Generate a random 16-byte IV for each encryption
      const iv = randomBytes(16);

      const cipher = createCipheriv(ALGORITHM, derivedKey, iv);
      let encrypted = cipher.update(plaintext, "utf8", "hex");
      encrypted += cipher.final("hex");

      return {
        encryptedData: encrypted,
        iv: iv.toString("hex"),
      };
    },

    decrypt(encryptedData: string, iv: string): string {
      const decipher = createDecipheriv(
        ALGORITHM,
        derivedKey,
        Buffer.from(iv, "hex")
      );

      let decrypted = decipher.update(encryptedData, "hex", "utf8");
      decrypted += decipher.final("utf8");

      return decrypted;
    },
  };
}
