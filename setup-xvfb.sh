
export DISPLAY=:99
export ELECTRON_ENABLE_LOGGING=1
export ELECTRON_DISABLE_GPU=1
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &