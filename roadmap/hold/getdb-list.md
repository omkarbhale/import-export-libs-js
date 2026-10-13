# Hold: the raw `<GetDB/>` database list

**What it is.** A database-list helper that POSTs `<GetDB/>` straight to the server over HTTP with Windows default credentials, then reads the database ids from the reply.

**Why it is held.** Neither import nor export reaches it. It exists for a host's login dialog.

**What would bring it in.** A CLI need to list a server's databases, for example a `list-databases` command. It would get its own `WIRE-` rule and a recorded fixture.
