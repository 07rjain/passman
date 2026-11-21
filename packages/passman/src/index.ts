export {
  PassmanError,
  type ErrorCode,
  type RuntimeMaterial,
  type SecretRecord,
} from "@passman/protocol";
export {
  RuntimeClient,
  RuntimeClient as PassmanClient,
  type RuntimeOptions,
  type SecretAddress,
} from "./runtime.js";
export {
  UnixFileStore,
  UnixRuntimeCustody,
  environmentRuntimeCustody,
  mountedRuntimeCustody,
  type RuntimeCustody,
  type VaultSelection,
} from "./custody.js";
export { NativeRuntimeCustody } from "./native-custody.js";
export { connect, forgetServiceKey, saveServiceKey } from "./connect.js";
export { login } from "./login.js";
