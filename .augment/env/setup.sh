#!/bin/bash
set -e

# Update package lists
sudo apt-get update

# Install Node.js and npm
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Xvfb and additional libraries required for VSCode
sudo apt-get install -y xvfb libnss3 libatk-bridge2.0-0 libdrm2 libxcomposite1 libxdamage1 libxrandr2 libgbm1 libxss1 libasound2

# Install additional dependencies for VSCode extension testing
sudo apt-get install -y libgtk-3-0 libxshmfence1 libgconf-2-4

# Install dbus for better VSCode integration (reduces warnings)
sudo apt-get install -y dbus-x11

# Verify installations
node --version
npm --version

# Navigate to workspace
cd /mnt/persist/workspace

# Install dependencies
npm install

# Compile tests and extension
npm run compile-tests
npm run compile

# Add npm global bin to PATH
echo 'export PATH="$PATH:$(npm config get prefix)/bin"' >> $HOME/.profile

# Set up display for headless testing
echo 'export DISPLAY=:99' >> $HOME/.profile
echo 'export ELECTRON_ENABLE_LOGGING=1' >> $HOME/.profile

# Disable GPU acceleration for more stable testing
echo 'export ELECTRON_DISABLE_GPU=1' >> $HOME/.profile

# Source the profile to make changes available
source $HOME/.profile

# Start Xvfb in background for headless testing
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &

# Start dbus session for better VSCode integration
eval $(dbus-launch --sh-syntax) > /dev/null 2>&1 &

# Wait a moment for services to start
sleep 3

echo "Setup completed successfully!"