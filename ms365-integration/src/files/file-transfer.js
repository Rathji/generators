// src/files/file-transfer.js — THIN SHIM.
// The implementation lives in main.pjs (a Perchance import pulls in only the
// other generator's main.pjs), so this module just re-exports the matching
// namespace of root.getMs365Api() — the same object importers receive. See
// src/runtime.js and src/README.md. Exported names mirror the original module.
import { ms365Api } from "../runtime.js";
export const driveItemPath = (...a) => ms365Api().files.transfer.driveItemPath(...a);
export const uploadFile = (...a) => ms365Api().files.transfer.uploadFile(...a);
export const downloadFile = (...a) => ms365Api().files.transfer.downloadFile(...a);
export const applyFormatExtension = (...a) => ms365Api().files.transfer.applyFormatExtension(...a);
export const simpleUploadLimit = () => ms365Api().files.transfer.simpleUploadLimit();
export const defaultChunkSize = () => ms365Api().files.transfer.defaultChunkSize();
