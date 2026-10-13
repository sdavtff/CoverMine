#!/usr/bin/env python3
"""Gera um APK instalável do VoxelCraft sem precisar do Android SDK.

O VoxelCraft é um jogo WebView: todo o código do jogo fica em app/src/main/assets.
Este script pega o APK base (wrapper Android já compilado, em tools/base/), troca a
pasta assets/ pelos arquivos atuais do projeto, alinha e assina o APK (esquemas v1+v2+v3)
com o uber-apk-signer (apksigner + zipalign oficiais do Android empacotados em um .jar).

Uso:
    python3 tools/build_apk.py [saida.apk]

Requisitos: Python 3 e Java 11+. O uber-apk-signer é baixado automaticamente na
primeira execução (ou coloque o .jar em tools/uber-apk-signer.jar).

Para compilar o projeto completo (incluindo a parte Java) use o Android Studio /
Gradle normalmente: ./gradlew assembleRelease (veja README.md).
"""
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.request
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE_APK = os.path.join(ROOT, 'tools', 'base', 'VoxelCraft-original.apk')
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')
SIGNER = os.path.join(ROOT, 'tools', 'uber-apk-signer.jar')
SIGNER_URL = 'https://github.com/patrickfav/uber-apk-signer/releases/download/v1.3.0/uber-apk-signer-1.3.0.jar'
KEYSTORE = os.path.join(ROOT, 'tools', 'voxelcraft.keystore')
KS_PASS = 'voxelcraft'
KS_ALIAS = 'voxelcraft'


def ensure_signer():
    if os.path.exists(SIGNER):
        return
    print('Baixando uber-apk-signer...')
    urllib.request.urlretrieve(SIGNER_URL, SIGNER)


def ensure_keystore():
    if os.path.exists(KEYSTORE):
        return
    print('Criando keystore de assinatura em tools/voxelcraft.keystore...')
    subprocess.check_call([
        'keytool', '-genkeypair', '-keystore', KEYSTORE, '-storepass', KS_PASS, '-keypass', KS_PASS,
        '-alias', KS_ALIAS, '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10000',
        '-dname', 'CN=VoxelCraft, O=VoxelCraft, C=BR',
    ])


def build_unsigned(path):
    with zipfile.ZipFile(BASE_APK) as src, zipfile.ZipFile(path, 'w') as dst:
        for info in src.infolist():
            name = info.filename
            if name.startswith('assets/'):
                continue
            if name.startswith('META-INF/') and name.upper().endswith(('.SF', '.RSA', '.DSA', '.EC', 'MANIFEST.MF')):
                continue
            data = src.read(name)
            zi = zipfile.ZipInfo(name, date_time=(1981, 1, 1, 1, 1, 2))
            # resources.arsc precisa ficar sem compressão (exigência do Android 11+)
            zi.compress_type = zipfile.ZIP_STORED if name == 'resources.arsc' else zipfile.ZIP_DEFLATED
            zi.external_attr = 0o644 << 16
            dst.writestr(zi, data)
        count = 0
        for dirpath, _, files in os.walk(ASSETS):
            for fn in sorted(files):
                full = os.path.join(dirpath, fn)
                rel = os.path.relpath(full, ASSETS).replace(os.sep, '/')
                zi = zipfile.ZipInfo('assets/' + rel, date_time=(1981, 1, 1, 1, 1, 2))
                zi.compress_type = zipfile.ZIP_DEFLATED
                zi.external_attr = 0o644 << 16
                with open(full, 'rb') as f:
                    dst.writestr(zi, f.read())
                count += 1
    print(f'{count} arquivos de assets empacotados.')


def main():
    out = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else os.path.join(ROOT, 'dist', 'VoxelCraft-HD.apk'))
    os.makedirs(os.path.dirname(out), exist_ok=True)
    ensure_signer()
    ensure_keystore()
    with tempfile.TemporaryDirectory() as tmp:
        unsigned = os.path.join(tmp, 'VoxelCraft-unsigned.apk')
        build_unsigned(unsigned)
        outdir = os.path.join(tmp, 'out')
        subprocess.check_call([
            'java', '-jar', SIGNER, '--apks', unsigned, '--out', outdir,
            '--ks', KEYSTORE, '--ksAlias', KS_ALIAS, '--ksPass', KS_PASS, '--ksKeyPass', KS_PASS,
            '--allowResign',
        ])
        signed = [f for f in os.listdir(outdir) if f.endswith('.apk')]
        if not signed:
            sys.exit('Falha ao assinar o APK')
        shutil.copyfile(os.path.join(outdir, signed[0]), out)
        subprocess.check_call(['java', '-jar', SIGNER, '--apks', out, '--onlyVerify'])
    print('APK gerado:', out)


if __name__ == '__main__':
    main()
