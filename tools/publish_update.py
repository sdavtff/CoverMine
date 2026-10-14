#!/usr/bin/env python3
"""Publica uma atualização automática do jogo para o celular e o PC.

Uso:
    python3 tools/publish_update.py 3.0.1 "texto da novidade"
    git push

O que faz:
 1. grava a nova versão em app/src/main/assets/version.js e cria um commit com o código;
 2. grava app/src/main/assets/update.json apontando para ESSE commit (imutável na CDN) e cria outro commit.

Depois do push, os APKs/EXEs já instalados (3.0.0 ou mais novos) encontram o update.json no GitHub ao
abrir o jogo com internet e carregam a versão nova direto da CDN (jsDelivr, com Statically e GitHack
como reserva). Sem internet, o jogo abre com a versão embutida. Mudanças na parte nativa (Java/Android
ou Electron) ainda exigem instalar um APK/EXE novo.
"""
import json
import os
import re
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ASSETS = os.path.join(ROOT, 'app', 'src', 'main', 'assets')


def git(*args):
    return subprocess.check_output(['git', '-C', ROOT, *args], text=True).strip()


def main():
    if len(sys.argv) < 2 or not re.fullmatch(r'\d+\.\d+\.\d+', sys.argv[1]):
        sys.exit('Uso: python3 tools/publish_update.py X.Y.Z ["notas"]')
    version = sys.argv[1]
    notes = sys.argv[2] if len(sys.argv) > 2 else f'VoxelCraft {version}'
    with open(os.path.join(ASSETS, 'version.js'), 'w') as f:
        f.write(f"export const VERSION = '{version}';\n")
    git('add', '-A', 'app/src/main/assets')
    git('commit', '-m', f'VoxelCraft {version}: {notes}')
    sha = git('rev-parse', 'HEAD')
    with open(os.path.join(ASSETS, 'update.json'), 'w') as f:
        json.dump({'version': version, 'ref': sha, 'notes': notes}, f, ensure_ascii=False)
        f.write('\n')
    git('add', os.path.join(ASSETS, 'update.json'))
    git('commit', '-m', f'Publica atualização automática {version}')
    print(f'Atualização {version} preparada (código no commit {sha[:10]}). Agora rode: git push')


if __name__ == '__main__':
    main()
