// afterPack hook for electron-builder: flip Electron fuses for security hardening
// See: https://www.electronjs.org/docs/latest/tutorial/fuses

const path = require('path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

const PREFIX = '[set-electron-fuses]';

module.exports = async function afterPack(context) {
  const { appOutDir, packager } = context;
  const { productFilename } = packager.appInfo;
  const platform = context.electronPlatformName;

  let electronBinaryPath;

  switch (platform) {
    case 'darwin':
      electronBinaryPath = path.join(appOutDir, `${productFilename}.app`);
      break;
    case 'win32':
      electronBinaryPath = path.join(appOutDir, `${productFilename}.exe`);
      break;
    case 'linux':
      electronBinaryPath = path.join(appOutDir, packager.executableName);
      break;
    default:
      console.log(`${PREFIX} Unknown platform "${platform}", skipping fuse configuration`);
      return;
  }

  console.log(`${PREFIX} Platform: ${platform}`);
  console.log(`${PREFIX} Binary: ${electronBinaryPath}`);
  console.log(`${PREFIX} Flipping fuses...`);

  await flipFuses(electronBinaryPath, {
    version: FuseVersion.V1,
    [FuseV1Options.RunAsNode]: false,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
    [FuseV1Options.OnlyLoadAppFromAsar]: true,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
    [FuseV1Options.GrantFileProtocolExtraPrivileges]: false,
  });

  console.log(`${PREFIX} Fuses flipped successfully`);
};
