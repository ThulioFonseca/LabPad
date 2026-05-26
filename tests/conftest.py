"""Configuracao compartilhada entre todos os testes.

Adiciona o diretorio backend ao sys.path para que os modulos possam ser
importados diretamente (sem instalar o pacote).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "backend"))
