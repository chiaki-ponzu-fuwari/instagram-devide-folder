import { readFileSync, writeFileSync } from 'node:fs';

const configUrl = new URL('../ios/App/App/capacitor.config.json', import.meta.url);
const packageUrl = new URL('../ios/App/CapApp-SPM/Package.swift', import.meta.url);
const appDelegateUrl = new URL('../ios/App/App/AppDelegate.swift', import.meta.url);
const requiredPlugins = ['SignInWithApple', 'AppReview', 'DeepLink'];
const firebasePackage = '.package(url: "https://github.com/firebase/firebase-ios-sdk.git", exact: "12.18.0")';
const firebaseProducts = [
  '.product(name: "FirebaseCore", package: "firebase-ios-sdk")',
  '.product(name: "FirebaseAuth", package: "firebase-ios-sdk")',
];

const config = JSON.parse(readFileSync(configUrl, 'utf8'));
const currentList = Array.isArray(config.packageClassList) ? config.packageClassList : [];
config.packageClassList = [
  ...requiredPlugins,
  ...currentList.filter((plugin) => !requiredPlugins.includes(plugin)),
];

writeFileSync(configUrl, `${JSON.stringify(config, null, '\t')}\n`);

let packageSwift = readFileSync(packageUrl, 'utf8');
if (!packageSwift.includes(firebasePackage)) {
  const dependencyAnchor = /^(\s*)\.package\(url: "https:\/\/github\.com\/ionic-team\/capacitor-swift-pm\.git", exact: "[^"]+"\),$/m;
  if (!dependencyAnchor.test(packageSwift)) {
    throw new Error('Unable to preserve Firebase dependency in CapApp-SPM/Package.swift');
  }
  packageSwift = packageSwift.replace(
    dependencyAnchor,
    (line, indent) => `${line}\n${indent}${firebasePackage},`,
  );
}

for (const product of firebaseProducts) {
  if (packageSwift.includes(product)) continue;
  const productAnchor = /^(\s*)\.product\(name: "Cordova", package: "capacitor-swift-pm"\),$/m;
  if (!productAnchor.test(packageSwift)) {
    throw new Error(`Unable to preserve ${product} in CapApp-SPM/Package.swift`);
  }
  packageSwift = packageSwift.replace(
    productAnchor,
    (line, indent) => `${line}\n${indent}${product},`,
  );
}
writeFileSync(packageUrl, packageSwift);

const appDelegate = readFileSync(appDelegateUrl, 'utf8');
for (const method of ['prepareAuthorizationRevocation', 'revokeAuthorizationCode']) {
  if (!appDelegate.includes(`CAPPluginMethod(name: "${method}"`)) {
    throw new Error(`SignInWithApple ${method} native method is missing`);
  }
}
