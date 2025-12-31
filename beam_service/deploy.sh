#!/usr/bin/env python3
"""
Deploy the Lyric Video Generator to Beam Cloud
"""

import subprocess
import sys
import os

def check_beam_auth():
    """Check if Beam is authenticated"""
    try:
        result = subprocess.run(["beam", "whoami"], capture_output=True, text=True)
        if "Not logged in" in result.stdout or "Not logged in" in result.stderr:
            print("❌ Please log in to Beam first:")
            print("   beam login")
            return False
        return True
    except FileNotFoundError:
        print("❌ Beam CLI not found. Please install it:")
        print("   pip install beam-cli")
        print("   beam login")
        return False

def deploy_to_beam():
    """Deploy the app to Beam"""
    print("🚀 Deploying Lyric Video Generator to Beam...")
    
    # Check authentication
    if not check_beam_auth():
        sys.exit(1)
    
    # Build and deploy
    try:
        print("📦 Building app...")
        result = subprocess.run(
            ["beam", "deploy", "app.py"],
            cwd=os.path.dirname(os.path.abspath(__file__)),
            capture_output=True,
            text=True
        )
        
        if result.returncode == 0:
            print("✅ Successfully deployed to Beam!")
            print("\n📋 Next steps:")
            print("1. Copy your Beam App ID from the output above")
            print("2. Add it to your Vercel environment variables as BEAM_APP_ID")
            print("3. Your API will be ready to use!")
        else:
            print("❌ Deployment failed:")
            print(result.stderr)
            sys.exit(1)
            
    except Exception as e:
        print(f"❌ Error during deployment: {e}")
        sys.exit(1)

if __name__ == "__main__":
    deploy_to_beam()