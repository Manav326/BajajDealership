#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';

const gradlePath = process.argv[2];
if (!gradlePath) {
  throw new Error('Usage: node scripts/configure-android-release-signing.mjs <android/app/build.gradle>');
}

function matchingBrace(source, openIndex) {
  let depth = 0;
  let mode = 'code';
  let quote = '';
  for (let i = openIndex; i < source.length; i += 1) {
    const ch = source[i];
    const next = source[i + 1];

    if (mode === 'line-comment') {
      if (ch === '\n') mode = 'code';
      continue;
    }
    if (mode === 'block-comment') {
      if (ch === '*' && next === '/') {
        mode = 'code';
        i += 1;
      }
      continue;
    }
    if (mode === 'string') {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) mode = 'code';
      continue;
    }
    if (ch === '/' && next === '/') {
      mode = 'line-comment';
      i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      mode = 'block-comment';
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === String.fromCharCode(96)) {
      mode = 'string';
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('Unbalanced Gradle braces while locating release signing configuration.');
}

function findBlock(source, name, start = 0, end = source.length) {
  const pattern = new RegExp('\\b' + name + '\\s*\\{', 'g');
  pattern.lastIndex = start;
  let match;
  while ((match = pattern.exec(source)) !== null && match.index < end) {
    const open = source.indexOf('{', match.index);
    const close = matchingBrace(source, open);
    if (close < end) return { name, start: match.index, open, close };
  }
  return null;
}

let source = await readFile(gradlePath, 'utf8');
const signing = findBlock(source, 'signingConfigs');
if (!signing) throw new Error('Expo-generated Gradle file has no signingConfigs block.');

const releaseSigning = [
  'release {',
  '    storeFile file(System.getenv("BAJAJ_ANDROID_KEYSTORE_FILE"))',
  '    storePassword System.getenv("BAJAJ_ANDROID_SIGNING_KEYSTORE_PASSWORD")',
  '    keyAlias System.getenv("BAJAJ_ANDROID_SIGNING_KEY_ALIAS")',
  '    keyPassword System.getenv("BAJAJ_ANDROID_SIGNING_KEY_PASSWORD")',
  '}',
].join('\n');

const existingReleaseSigning = findBlock(source, 'release', signing.open + 1, signing.close);
if (existingReleaseSigning) {
  source = source.slice(0, existingReleaseSigning.start) + releaseSigning + source.slice(existingReleaseSigning.close + 1);
} else {
  const currentSigning = findBlock(source, 'signingConfigs');
  source = source.slice(0, currentSigning.close) + '\n    ' + releaseSigning + '\n' + source.slice(currentSigning.close);
}

const buildTypes = findBlock(source, 'buildTypes');
if (!buildTypes) throw new Error('Expo-generated Gradle file has no buildTypes block.');
const releaseBuild = findBlock(source, 'release', buildTypes.open + 1, buildTypes.close);
if (!releaseBuild) throw new Error('Expo-generated Gradle file has no release build type.');

let releaseBody = source.slice(releaseBuild.start, releaseBuild.close + 1);
const signingLine = /^([ \t]*)signingConfig\s+signingConfigs\.(?:debug|release)\s*$/m;
const signingMatch = releaseBody.match(signingLine);
if (signingMatch) {
  releaseBody = releaseBody.replace(signingLine, signingMatch[1] + 'signingConfig signingConfigs.release');
} else {
  const braceOffset = releaseBody.indexOf('{');
  releaseBody = releaseBody.slice(0, braceOffset + 1) + '\n        signingConfig signingConfigs.release' + releaseBody.slice(braceOffset + 1);
}
source = source.slice(0, releaseBuild.start) + releaseBody + source.slice(releaseBuild.close + 1);

for (const required of [
  'BAJAJ_ANDROID_KEYSTORE_FILE',
  'BAJAJ_ANDROID_SIGNING_KEYSTORE_PASSWORD',
  'BAJAJ_ANDROID_SIGNING_KEY_ALIAS',
  'BAJAJ_ANDROID_SIGNING_KEY_PASSWORD',
  'signingConfig signingConfigs.release',
]) {
  if (!source.includes(required)) throw new Error('Release signing setup is incomplete: ' + required);
}

await writeFile(gradlePath, source, 'utf8');
console.log('Configured Android release builds to use the Lucky Bajaj upload keystore.');
