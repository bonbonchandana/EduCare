"""Start the API without the Flask reloader (useful for stable background runs)."""
import os
from api import app

if __name__ == '__main__':
    # run without debug/reloader so the process stays single-threaded and
    # easier to manage from an external launcher.
    # Allow overriding the port via the EDUCARE_PORT environment variable.
    port = int(os.environ.get('EDUCARE_PORT', '8000'))
    app.run(host='127.0.0.1', port=port, debug=False)
