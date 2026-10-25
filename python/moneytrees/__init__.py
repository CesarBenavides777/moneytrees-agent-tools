"""Python client for MoneyTrees (https://moneytrees.ai)."""

from .client import DEFAULT_BASE_URL, VERSION, MoneyTrees, MoneyTreesError, tool_text

__version__ = VERSION
__all__ = ["DEFAULT_BASE_URL", "MoneyTrees", "MoneyTreesError", "VERSION", "tool_text"]
