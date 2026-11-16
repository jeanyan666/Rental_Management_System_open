from __future__ import annotations

import logging
import threading
import time
from urllib.request import urlopen

logger = logging.getLogger(__name__)


def start_keepalive(url: str, interval_seconds: int) -> None:
    """Ping the public app URL so the hosting instance does not scale to zero."""
    if not url:
        return

    interval = max(60, min(interval_seconds, 3600))

    def run() -> None:
        while True:
            time.sleep(interval)
            try:
                with urlopen(url, timeout=20) as response:
                    response.read(1)
            except Exception:
                logger.debug("keepalive ping failed", exc_info=True)

    threading.Thread(target=run, name="rental-keepalive", daemon=True).start()
