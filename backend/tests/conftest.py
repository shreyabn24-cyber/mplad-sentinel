"""Shared test configuration.

The repository ships a template ``SECRET_KEY`` in ``.env``, and
``auth.create_access_token`` rightly refuses to sign with it. Any test that needs
to issue a token therefore has to install a generated one first.

This lives in ``conftest.py`` rather than at the top of each test module because
it has to run *before* the application module is imported, and because duplicating
it in three files meant each module had to remember the ordering on its own.
The override touches the in-process settings object only; nothing here changes a
deployment's configuration.
"""

import secrets

from config import settings

settings.SECRET_KEY = secrets.token_urlsafe(48)
