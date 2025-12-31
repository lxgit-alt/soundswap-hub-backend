import os
import sys
import platform
import gc
import hashlib
import json
import base64
import tempfile
import math
import random
import time
import traceback
import uuid
import cv2
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Tuple, Any, Optional
from concurrent.futures import ThreadPoolExecutor, ProcessPoolExecutor
from functools import lru_cache
from collections import OrderedDict
from io import BytesIO

# ============================================
# PLATFORM CONFIGURATION
# ============================================

# Define font paths for different platforms
FONT_PATHS = []

if platform.system() == "Windows":
    FONT_PATHS = [
        os.path.join(os.environ.get('WINDIR', 'C:\\Windows'), 'Fonts'),
    ]
    print("✓ Windows font paths configured")
elif platform.system() == "Darwin":  # macOS
    FONT_PATHS = [
        "/Library/Fonts",
        os.path.expanduser("~/Library/Fonts")
    ]
    print("✓ macOS font paths configured")
else:  # Linux (Beam environment)
    FONT_PATHS = [
        "/usr/share/fonts",
        "/usr/local/share/fonts",
        "/app/fonts",
        "/app/backend/beam/fonts"
    ]
    os.environ["IMAGEMAGICK_BINARY"] = "convert"
    print("✓ Linux/Beam environment configured")
    print(f"  - Font paths: {FONT_PATHS}")
    print(f"  - ImageMagick binary: convert")

import beam
from beam import Image, Volume

video_gen_image = Image(
    python_version="python3.11",
    python_packages="requirements.txt",
    commands=[
        # 1. System Install
        "apt-get update && apt-get install -y ffmpeg libsm6 libxext6 libfontconfig1 libxrender1 imagemagick libmagickwand-dev ghostscript",
        
        # 2. Fix ImageMagick Policies using multi-line Python script
        "cat > /tmp/fix_policy.py << 'EOF'\n"
        "import os\n"
        "path = '/etc/ImageMagick-6/policy.xml'\n"
        "with open(path) as f:\n"
        "    data = f.read()\n"
        "data = data.replace('rights=\"none\" pattern=\"PDF\"', 'rights=\"read|write\" pattern=\"PDF\"')\n"
        "data = data.replace('rights=\"none\" pattern=\"MP4\"', 'rights=\"read|write\" pattern=\"MP4\"')\n"
        "data = data.replace('domain=\"path\" rights=\"none\"', 'domain=\"path\" rights=\"read|write\"')\n"
        "with open(path, 'w') as f:\n"
        "    f.write(data)\n"
        "EOF\n"
        "python3 /tmp/fix_policy.py",
        
        # 3. Font Configuration
        "mkdir -p /usr/share/fonts/truetype/custom",
        "cp -rf ./fonts/* /usr/share/fonts/truetype/custom/ 2>/dev/null || true",
        "fc-cache -f -v",
        
        # 4. Verification
        "echo 'ImageMagick Policy Updated Successfully'"
    ]
)

# 2. Volume Definition
cache_volume = Volume(name="vidgen_models_storage", mount_path="./models")

from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageColor
import logging

logger = logging.getLogger(__name__)
try:
    from rake_nltk import Rake
    import nltk
    # Download required NLTK data
    nltk.download('punkt', quiet=True)
    nltk.download('stopwords', quiet=True)
    RAKE_AVAILABLE = True
    logger.info("RAKE-NLTK keyword extractor loaded successfully.")
except ImportError as e:
    Rake = None
    RAKE_AVAILABLE = False
    logger.warning(f"RAKE-NLTK not available: {str(e)}")

# Updated MoviePy imports for v2.x
try:
    # Everything from the old 'editor' is now in the root 'moviepy' or 'moviepy.video'
    from moviepy import TextClip, ImageClip, CompositeVideoClip, concatenate_videoclips
    # For your 'mp.TextClip' references:
    import moviepy as mp 
    # For effects:
    from moviepy.video import fx as vfx
    
    MOVIEPY_AVAILABLE = True
    print("MoviePy 2.x imported successfully")
except ImportError as e:
    print(f"MoviePy import error: {e}")
    MOVIEPY_AVAILABLE = False

import numpy as np
import cloudinary
import cloudinary.uploader
import cloudinary.api

try:
    import requests
    REQUESTS_AVAILABLE = True
    logger.info("requests library available")
except ImportError:
    requests = None
    REQUESTS_AVAILABLE = False
    logger.warning("requests not available - webhook features disabled")

try:
    from huggingface_hub import InferenceClient
    HF_INFERENCE_AVAILABLE = True
    logger.info("HuggingFace InferenceClient available")
except ImportError:
    InferenceClient = None
    HF_INFERENCE_AVAILABLE = False
    logger.warning("huggingface-hub not available - AI texture generation disabled")

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('video_generator.log')
    ]
)
logger = logging.getLogger(__name__)

# Conditional imports for AI/ML features
try:
    import torch
    from transformers import pipeline
    AI_AVAILABLE = True
    logger.info("AI libraries loaded successfully.")
    _ = torch.__version__
except ImportError as e:
    torch = None
    pipeline = None
    AI_AVAILABLE = False
    logger.warning(f"AI libraries not available: {str(e)}")

# ============================================
# CLOUD STORAGE MANAGER WITH AGGRESSIVE DELETION
# ============================================

class StorageLifecycleManager:
    """
    Manages strict 24-hour deletion policy for video assets
    Prevents storage debt accumulation
    """
    
    def __init__(self, storage_backend: str = "cloudinary"):
        """
        Initialize storage lifecycle manager
        
        Args:
            storage_backend: "cloudinary"
        """
        self.storage_backend = storage_backend
        self.expiry_hours = 24  # Strict 24-hour deletion policy
        self.pending_deletions = {}
        self.cleanup_lock = threading.Lock()
        
        # Initialize cloud storage connections
        self._init_cloudinary()
        
        # Start background cleanup scheduler
        self._start_cleanup_scheduler()
    
    def _init_cloudinary(self):
        """Initialize Cloudinary configuration"""
        cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
        api_key = os.getenv("CLOUDINARY_API_KEY")
        api_secret = os.getenv("CLOUDINARY_API_SECRET")
        
        if all([cloud_name, api_key, api_secret]):
            cloudinary.config(
                cloud_name=cloud_name,
                api_key=api_key,
                api_secret=api_secret
            )
            self.cloudinary_available = True
            logger.info("Cloudinary storage initialized")
        else:
            self.cloudinary_available = False
            logger.warning("Cloudinary credentials not configured")
    
    def _start_cleanup_scheduler(self):
        """Start background thread for cleanup operations"""
        def cleanup_worker():
            while True:
                try:
                    time.sleep(3600)  # Run every hour
                    self._perform_scheduled_cleanup()
                except Exception as e:
                    logger.error(f"Cleanup worker error: {e}")
                    time.sleep(300)  # Wait 5 minutes on error
        
        cleanup_thread = threading.Thread(target=cleanup_worker, daemon=True)
        cleanup_thread.start()
        logger.info("Background cleanup scheduler started")
    
    def _perform_scheduled_cleanup(self):
        """Perform scheduled cleanup of expired assets"""
        with self.cleanup_lock:
            try:
                now = datetime.utcnow()
                expired_count = 0
                
                # Check Cloudinary for expired assets
                if self.cloudinary_available:
                    expired_count += self._cleanup_cloudinary_assets()
                
                # Check S3 for expired assets
                if self.s3_available:
                    expired_count += self._cleanup_s3_assets()
                
                # Cleanup local pending deletions
                self._cleanup_pending_deletions()
                
                if expired_count > 0:
                    logger.info(f"Scheduled cleanup completed: {expired_count} assets deleted")
                
            except Exception as e:
                logger.error(f"Scheduled cleanup failed: {e}")
    
    def _cleanup_cloudinary_assets(self):
        """Cleanup expired Cloudinary assets"""
        try:
            # List all assets in lyric-videos folder
            result = cloudinary.api.resources(
                type="upload",
                resource_type="video",
                prefix="lyric-videos/",
                max_results=100
            )
            
            expired_count = 0
            for resource in result.get('resources', []):
                created_at = datetime.strptime(resource['created_at'], "%Y-%m-%dT%H:%M:%S%z")
                age_hours = (datetime.utcnow().replace(tzinfo=created_at.tzinfo) - created_at).total_seconds() / 3600
                
                if age_hours >= self.expiry_hours:
                    try:
                        cloudinary.uploader.destroy(
                            resource['public_id'],
                            resource_type='video',
                            invalidate=True
                        )
                        expired_count += 1
                        logger.debug(f"Deleted expired Cloudinary asset: {resource['public_id']}")
                    except Exception as e:
                        logger.warning(f"Failed to delete Cloudinary asset {resource['public_id']}: {e}")
            
            return expired_count
            
        except Exception as e:
            logger.error(f"Cloudinary cleanup error: {e}")
            return 0

    
    def _cleanup_pending_deletions(self):
        """Cleanup local pending deletions that have expired"""
        now = time.time()
        to_delete = []
        
        for asset_id, expiry_time in self.pending_deletions.items():
            if now >= expiry_time:
                to_delete.append(asset_id)
        
        for asset_id in to_delete:
            del self.pending_deletions[asset_id]
            logger.debug(f"Removed pending deletion for expired asset: {asset_id}")
    
    def schedule_deletion(self, asset_id: str, asset_url: str, storage_type: str = "cloudinary"):
        """
        Schedule an asset for deletion after 24 hours
        
        Args:
            asset_id: Unique identifier for the asset
            asset_url: URL of the asset
            storage_type: Type of storage (cloudinary)
        """
        expiry_time = time.time() + (self.expiry_hours * 3600)
        self.pending_deletions[asset_id] = expiry_time
        
        logger.info(f"Scheduled deletion for asset {asset_id} at {datetime.fromtimestamp(expiry_time)}")
        
        # Also schedule immediate background deletion for safety
        threading.Thread(
            target=self._delete_after_delay,
            args=(asset_id, asset_url, storage_type, self.expiry_hours * 3600),
            daemon=True
        ).start()
    
    def _delete_after_delay(self, asset_id: str, asset_url: str, storage_type: str, delay_seconds: int):
        """Delete asset after specified delay"""
        try:
            time.sleep(delay_seconds)
            self.delete_asset(asset_id, asset_url, storage_type)
        except Exception as e:
            logger.error(f"Background deletion failed for {asset_id}: {e}")
    
    def delete_asset(self, asset_id: str, asset_url: str, storage_type: str = "cloudinary"):
        """
        Immediately delete an asset
        
        Args:
            asset_id: Unique identifier for the asset
            asset_url: URL of the asset
            storage_type: Type of storage (cloudinary)
        """
        try:
            if storage_type == "cloudinary" and self.cloudinary_available:
                # Extract public_id from Cloudinary URL
                import re
                match = re.search(r'/([^/]+)\.(mp4|webm|mov|avi)$', asset_url)
                if match:
                    public_id = match.group(1)
                    cloudinary.uploader.destroy(public_id, resource_type='video', invalidate=True)
                    logger.info(f"Deleted Cloudinary asset: {public_id}")
            
            elif storage_type == "s3" and self.s3_available:
                # Extract S3 key from URL
                key = asset_url.split(f"{self.s3_bucket}/")[-1] if f"{self.s3_bucket}/" in asset_url else asset_url
                self.s3_client.delete_object(Bucket=self.s3_bucket, Key=key)
                logger.info(f"Deleted S3 object: {key}")
            
            # Remove from pending deletions
            if asset_id in self.pending_deletions:
                del self.pending_deletions[asset_id]
            
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete asset {asset_id}: {e}")
            return False
    
    def generate_signed_url(self, asset_url: str, expiry_hours: int = 24, storage_type: str = "cloudinary"):
        """
        Generate a signed URL with expiration
        
        Args:
            asset_url: Original asset URL
            expiry_hours: Hours until URL expires (default: 24)
            storage_type: Type of storage
        
        Returns:
            Signed URL with expiration
        """
        try:
            if storage_type == "s3" and self.s3_available:
                # Generate S3 presigned URL
                key = asset_url.split(f"{self.s3_bucket}/")[-1] if f"{self.s3_bucket}/" in asset_url else asset_url
                signed_url = self.s3_client.generate_presigned_url(
                    'get_object',
                    Params={'Bucket': self.s3_bucket, 'Key': key},
                    ExpiresIn=expiry_hours * 3600
                )
                return signed_url
            
            elif storage_type == "cloudinary" and self.cloudinary_available:
                # Cloudinary URLs can have expiration via transformations
                import urllib.parse
                parsed_url = urllib.parse.urlparse(asset_url)
                query_params = urllib.parse.parse_qs(parsed_url.query)
                query_params['_expires'] = [str(int(time.time()) + (expiry_hours * 3600))]
                
                new_query = urllib.parse.urlencode(query_params, doseq=True)
                signed_url = urllib.parse.urlunparse((
                    parsed_url.scheme,
                    parsed_url.netloc,
                    parsed_url.path,
                    parsed_url.params,
                    new_query,
                    parsed_url.fragment
                ))
                return signed_url
            
            # For other storage types, return original URL with warning
            logger.warning(f"Cannot generate signed URL for storage type: {storage_type}")
            return asset_url
            
        except Exception as e:
            logger.error(f"Failed to generate signed URL: {e}")
            return asset_url
    
    def get_storage_usage(self):
        """Get current storage usage statistics"""
        stats = {
            "total_assets": 0,
            "pending_deletions": len(self.pending_deletions),
            "storage_backends": {},
            "estimated_cost_per_month": 0
        }
        
        # Estimate Cloudinary usage
        if self.cloudinary_available:
            try:
                result = cloudinary.api.usage()
                stats["storage_backends"]["cloudinary"] = {
                    "storage_used_mb": result.get("storage", {}).get("usage", 0) / 1024,
                    "bandwidth_used_mb": result.get("bandwidth", {}).get("usage", 0) / 1024,
                    "transformation_usage": result.get("transformations", {}).get("usage", 0)
                }
                stats["total_assets"] += result.get("resources", {}).get("usage", 0)
            except Exception as e:
                logger.warning(f"Could not get Cloudinary usage: {e}")
        
        return stats

# Initialize global storage manager
storage_manager = StorageLifecycleManager()

# ============================================
# OPTIMIZATION CONFIGURATION
# ============================================

class OptimizationConfig:
    """Configuration for model optimizations"""
    
    # Cache for model weights and generated content
    MODEL_CACHE = OrderedDict()
    CACHE_MAX_SIZE = 50
    
    # Thread/process pools for parallel processing
    THREAD_POOL = ThreadPoolExecutor(max_workers=4)
    PROCESS_POOL = ProcessPoolExecutor(max_workers=2)
    
    # Adaptive resolution settings
    ADAPTIVE_RESOLUTIONS = {
        "fast": (854, 480),
        "standard": (1280, 720),
        "quality": (1920, 1080)
    }
    
    # Cache for pre-rendered elements
    BACKGROUND_CACHE = {}
    TEXTURE_CACHE = {}
    FONT_CACHE = {}

# ============================================
# QUANTIZATION UTILITIES
# ============================================

class QuantizationManager:
    """8-bit quantization for model weights and activations"""
    
    @staticmethod
    def quantize_image_to_8bit(image: Image.Image) -> Image.Image:
        """Convert image to 8-bit for faster processing"""
        if image.mode == 'RGBA':
            background = Image.new('RGB', image.size, (255, 255, 255))
            background.paste(image, mask=image.split()[3])
            image = background.convert('P', palette=Image.ADAPTIVE, colors=256)
        elif image.mode not in ['L', 'P']:
            image = image.convert('P', palette=Image.ADAPTIVE, colors=256)
        return image
    
    @staticmethod
    def compress_texture_for_cache(texture_base64: str, quality: int = 85) -> str:
        """Compress texture with adjustable quality"""
        try:
            img_data = base64.b64decode(texture_base64)
            img = Image.open(BytesIO(img_data))
            
            if max(img.size) > 2048:
                ratio = 2048 / max(img.size)
                new_size = (int(img.width * ratio), int(img.height * ratio))
                img = img.resize(new_size, Image.Resampling.LANCZOS)
            
            img = QuantizationManager.quantize_image_to_8bit(img)
            
            buffered = BytesIO()
            img.save(buffered, format="WEBP", quality=quality, optimize=True)
            return base64.b64encode(buffered.getvalue()).decode()
        except Exception:
            return texture_base64

# ============================================
# PARALLEL PROCESSING MANAGER
# ============================================

class ParallelProcessor:
    """Parallel processing for scene generation"""
    
    @staticmethod
    def parallel_generate_scenes(lyrics: List[dict], style_profile: dict, 
                                 max_workers: int = 4) -> List[dict]:
        """Generate scenes in parallel"""
        from concurrent.futures import as_completed
        
        scenes = []
        previous_images = []
        
        def process_single_lyric(args):
            i, lyric = args
            try:
                image_base64 = generate_styled_background(lyric, style_profile)
                
                if UniquenessValidator.check_uniqueness(image_base64, previous_images):
                    previous_images.append(image_base64)
                    
                    duration = calculate_lyric_duration(lyric)
                    return {
                        "id": i + 1,
                        "lyric": lyric.get("text", ""),
                        "image_url": f"data:image/png;base64,{image_base64}",
                        "time": lyric.get("time", 0),
                        "duration": duration,
                        "style": style_profile["name"],
                        "rendering_data": {
                            "font_tag": style_profile["font_tag"],
                            "animation_tag": style_profile["animation_tag"],
                            "effect_tag": style_profile["effect_tag"],
                            "color_tag": style_profile["color_tag"],
                            "intensity": style_profile["intensity"]
                        }
                    }
            except Exception as e:
                logger.error(f"Parallel scene generation failed: {e}")
            return None
        
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = [executor.submit(process_single_lyric, (i, lyric)) 
                      for i, lyric in enumerate(lyrics)]
            
            for future in as_completed(futures):
                scene = future.result()
                if scene:
                    scenes.append(scene)
        
        scenes.sort(key=lambda x: x["id"])
        return scenes

# ============================================
# ADAPTIVE RESOLUTION MANAGER
# ============================================

class AdaptiveResolutionManager:
    """Adaptive resolution for different contexts"""
    
    @staticmethod
    def get_adaptive_resolution(quality: str = "balanced", 
                                preview: bool = False) -> tuple:
        """Get resolution based on quality requirements"""
        if preview:
            return (640, 360)
        
        resolutions = {
            "fast": (854, 480),
            "balanced": (1280, 720),
            "quality": (1920, 1080),
            "ultra": (2560, 1440)
        }
        return resolutions.get(quality, (1280, 720))
    
    @staticmethod
    def adapt_image_resolution(image: Image.Image, target_size: tuple,
                               quality: str = "balanced") -> Image.Image:
        """Adapt image resolution with intelligent downscaling"""
        if image.size == target_size:
            return image
        
        if quality in ["fast", "preview"]:
            resample = Image.Resampling.NEAREST
        elif quality == "balanced":
            resample = Image.Resampling.BILINEAR
        else:
            resample = Image.Resampling.LANCZOS
        
        return image.resize(target_size, resample)

# ============================================
# MODEL CACHING SYSTEM
# ============================================

class ModelCache:
    """Cache system for models and generated content"""
    
    _cache = OrderedDict()
    _max_size = 100
    
    @classmethod
    def get_cache_key(cls, *args, **kwargs) -> str:
        """Generate cache key from arguments"""
        key_parts = []
        
        for arg in args:
            if isinstance(arg, (str, int, float, bool)):
                key_parts.append(str(arg))
            elif isinstance(arg, dict):
                key_parts.append(hashlib.md5(json.dumps(arg, sort_keys=True).encode()).hexdigest())
        
        for k, v in sorted(kwargs.items()):
            key_parts.append(f"{k}:{v}")
        
        return hashlib.md5("|".join(key_parts).encode()).hexdigest()
    
    @classmethod
    @lru_cache(maxsize=100)
    def cached_generate_background(cls, lyric_text: str, style_name: str, 
                                   mood: str = "neutral") -> str:
        """Cached background generation"""
        lyric = {"text": lyric_text, "mood": mood}
        style_profile = STYLE_PROFILES.get(style_name, STYLE_PROFILES["dreamy_ethereal"])
        
        seed = hash(f"{lyric_text}_{style_name}_{mood}") % (2**31)
        random.seed(seed)
        
        if "dreamy" in style_name.lower():
            return generate_dreamy_ethereal_background_varied(lyric, seed)
        elif "minimal" in style_name.lower():
            return generate_minimalist_background_varied(lyric, seed)
        else:
            return generate_dreamy_ethereal_background_varied(lyric, seed)
    
    @classmethod
    def cache_texture(cls, key: str, texture: str):
        """Cache texture with LRU eviction"""
        cls._cache[key] = texture
        cls._cache.move_to_end(key)
        
        if len(cls._cache) > cls._max_size:
            cls._cache.popitem(last=False)
    
    @classmethod
    def get_cached_texture(cls, key: str) -> Optional[str]:
        """Get cached texture if exists"""
        if key in cls._cache:
            cls._cache.move_to_end(key)
            return cls._cache[key]
        return None

# ============================================
# OPTIMIZED ENCODING MANAGER
# ============================================

class OptimizedEncoder:
    """Optimized video encoding with configurable quality"""
    
    ENCODING_PROFILES = {
        "fast": {
            "preset": "ultrafast",
            "bitrate": "2000k",
            "crf": 28,
            "threads": 2,
            "quality": "low"
        },
        "balanced": {
            "preset": "fast",
            "bitrate": "5000k",
            "crf": 23,
            "threads": 4,
            "quality": "medium"
        },
        "quality": {
            "preset": "medium",
            "bitrate": "10000k",
            "crf": 18,
            "threads": 6,
            "quality": "high"
        },
        "ultra": {
            "preset": "slow",
            "bitrate": "20000k",
            "crf": 14,
            "threads": 8,
            "quality": "ultra"
        }
    }
    
    @staticmethod
    def get_encoding_profile(quality: str = "balanced", 
                            preview: bool = False) -> dict:
        """Get encoding profile based on quality requirements"""
        if preview:
            return OptimizedEncoder.ENCODING_PROFILES["fast"]
        return OptimizedEncoder.ENCODING_PROFILES.get(
            quality, 
            OptimizedEncoder.ENCODING_PROFILES["balanced"]
        )
    
    @staticmethod
    def optimize_video_encoding(clips: list, output_path: str, 
                               profile: dict = None) -> None:
        """Optimize video encoding with selected profile"""
        if not profile:
            profile = OptimizedEncoder.ENCODING_PROFILES["balanced"]
        
        if clips:
            video = mp.concatenate_videoclips(clips, method="compose")
            
            video.write_videofile(
                output_path,
                fps=24,
                codec="libx264",
                audio_codec=None,
                remove_temp=True,
                verbose=False,
                logger=None,
                threads=profile["threads"],
                preset=profile["preset"],
                bitrate=profile["bitrate"],
                ffmpeg_params=["-crf", str(profile["crf"])]
            )
    
    @staticmethod
    def batch_encode_clips(clips: List[mp.VideoClip], 
                          output_pattern: str,
                          batch_size: int = 5) -> List[str]:
        """Encode clips in batches to save memory"""
        output_paths = []
        
        for i in range(0, len(clips), batch_size):
            batch = clips[i:i+batch_size]
            if batch:
                output_path = f"{output_pattern}_batch_{i//batch_size}.mp4"
                video = mp.concatenate_videoclips(batch, method="compose")
                
                video.write_videofile(
                    output_path,
                    fps=24,
                    codec="libx264",
                    preset="fast",
                    bitrate="3000k",
                    threads=2,
                    verbose=False,
                    logger=None
                )
                output_paths.append(output_path)
                video.close()
                
                gc.collect()
        
        return output_paths

# ============================================
# MOTION INTERPOLATION
# ============================================

class MotionInterpolator:
    """Motion interpolation for smoother animations"""
    
    @staticmethod
    def interpolate_frames(clip1: mp.VideoClip, clip2: mp.VideoClip, 
                          transition_duration: float = 0.5) -> mp.VideoClip:
        """Create smooth transition between clips"""
        try:
            return mp.CompositeVideoClip([
                clip1.set_duration(clip1.duration),
                clip2.set_start(clip1.duration - transition_duration)
                      .crossfadein(transition_duration)
            ]).set_duration(clip1.duration + clip2.duration - transition_duration)
        except:
            return mp.concatenate_videoclips([clip1, clip2])
    
@staticmethod
def smooth_animation(text_clip: "mp.TextClip", scene: dict, 
                    interpolation: str = "linear") -> "mp.TextClip":
    """Apply motion smoothing to animations"""
    rendering_data = scene["rendering_data"]
    animation_tag = rendering_data.get("animation_tag", "float_fade")
    
    if animation_tag.startswith("ANIMATION_"):
        animation_tag = animation_tag.replace("ANIMATION_", "").lower()
    
    if animation_tag in ANIMATION_FUNCTION_MAP:
        animated_clip = ANIMATION_FUNCTION_MAP[animation_tag](
            text_clip, 
            scene["duration"], 
            rendering_data.get("intensity", "medium")
        )
        
        if interpolation == "smooth":
            try:
                # In v2.x, effects might have different names or patterns
                # Try this alternative approach for smooth transitions
                from moviepy.video.fx import FadeIn, FadeOut
                # Apply crossfade effect for smoothness
                animated_clip = animated_clip.with_effects([
                    FadeIn(0.3), 
                    FadeOut(0.3)
                ])
            except Exception as e:
                print(f"Smooth animation effect error: {e}")
                pass
        
        return animated_clip
    else:
        from moviepy.video.fx import FadeIn, FadeOut
        return text_clip.with_effects([FadeIn(0.3), FadeOut(0.3)])

# ============================================
# OPTIMIZED VIDEO PIPELINE (MAIN CLASS)
# ============================================

class OptimizedVideoPipeline:
    """Main optimized pipeline with all performance improvements"""
    
    def __init__(self, config: dict = None):
        """Initialize with optimization configuration"""
        self.config = config or {
            "enable_quantization": True,
            "parallel_processing": True,
            "adaptive_resolution": True,
            "model_caching": True,
            "optimized_encoding": True,
            "motion_interpolation": True,
            "preview_enabled": False,
            "quality_mode": "balanced",
            "aggressive_deletion": True,  # Enable 24-hour deletion policy
            "storage_type": "cloudinary"  # cloudinary
        }
        
        self.quantizer = QuantizationManager() if self.config["enable_quantization"] else None
        self.parallel_processor = ParallelProcessor() if self.config["parallel_processing"] else None
        self.resolution_manager = AdaptiveResolutionManager() if self.config["adaptive_resolution"] else None
        self.cache = ModelCache() if self.config["model_caching"] else None
        self.encoder = OptimizedEncoder() if self.config["optimized_encoding"] else None
        self.interpolator = MotionInterpolator() if self.config["motion_interpolation"] else None
        
        # Storage manager for aggressive deletion
        self.storage_manager = storage_manager if self.config.get("aggressive_deletion", True) else None
        
        self.metrics = {
            "start_time": None,
            "end_time": None,
            "memory_usage": [],
            "gpu_usage": 0,
            "storage_usage": {}
        }
    
    def generate_optimized_video(self, data: dict) -> dict:
        """Generate video with all optimizations enabled"""
        self.metrics["start_time"] = time.time()
        
        try:
            logger.info("Starting optimized video generation...")
            
            style_profile = self._select_style_profile(data)
            target_size = self._get_optimal_resolution(data)
            scenes = self._generate_optimized_scenes(data, style_profile)
            video_path = self._create_optimized_video(scenes, data, style_profile, target_size)
            
            # Upload with storage lifecycle management
            upload_result = self._upload_with_lifecycle(video_path, data)
            
            # Generate signed URL with expiration
            signed_url = self._generate_signed_download_url(upload_result, data)
            
            cleanup_temp_files(video_path)
            
            # Schedule automatic deletion after 24 hours
            if self.storage_manager and self.config.get("aggressive_deletion", True):
                asset_id = upload_result.get("public_id", str(uuid.uuid4()))
                self.storage_manager.schedule_deletion(
                    asset_id=asset_id,
                    asset_url=upload_result["secure_url"],
                    storage_type=self.config.get("storage_type", "cloudinary")
                )
            
            self.metrics["end_time"] = time.time()
            self.metrics["storage_usage"] = self.storage_manager.get_storage_usage() if self.storage_manager else {}
            
            return {
                "success": True,
                "video_url": signed_url,  # Use signed URL instead of direct URL
                "public_id": upload_result["public_id"],
                "duration": upload_result.get("duration", 0),
                "format": upload_result.get("format", "mp4"),
                "scenes": len(scenes),
                "style": style_profile["name"],
                "performance_metrics": self._get_performance_metrics(),
                "optimizations_applied": list(self.config.keys()),
                "deletion_scheduled": self.config.get("aggressive_deletion", True),
                "expires_at": time.time() + (24 * 3600)  # 24 hours from now
            }
            
        except Exception as e:
            logger.error(f"Optimized video generation failed: {str(e)}")
            logger.error(traceback.format_exc())
            raise
    
    def _upload_with_lifecycle(self, video_path: str, data: dict) -> dict:
        """Upload video with lifecycle metadata"""
        cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
        api_key = os.getenv("CLOUDINARY_API_KEY")
        api_secret = os.getenv("CLOUDINARY_API_SECRET")
        
        if not all([cloud_name, api_key, api_secret]):
            logger.warning("Cloudinary credentials not configured. Returning local file info.")
            
            try:
                video = mp.VideoFileClip(video_path)
                duration = video.duration
                video.close()
            except:
                duration = 0
            
            return {
                "secure_url": f"file://{video_path}",
                "public_id": f"local-test-{int(time.time())}",
                "duration": duration,
                "format": "mp4",
                "local_path": video_path
            }
        
        try:
            logger.info(f"Uploading video to Cloudinary with lifecycle policy: {video_path}")
            
            public_id = f"lyric-videos/{data.get('jobId', f'video-{int(time.time())}')}"
            
            # Add expiration metadata to the asset
            expires_at = datetime.utcnow() + timedelta(hours=24)
            
            upload_result = cloudinary.uploader.upload(
                video_path,
                resource_type="video",
                public_id=public_id,
                folder="lyric-videos",
                overwrite=True,
                timeout=300,
                context=f"expires_at={expires_at.isoformat()}|auto_delete=true",
                tags=["auto_delete_24h", "lyric_video"]
            )
            
            logger.info(f"Upload successful with lifecycle: {upload_result['secure_url']}")
            return upload_result
            
        except Exception as e:
            logger.error(f"Cloudinary upload failed: {str(e)}")
            return {
                "secure_url": f"file://{video_path}",
                "public_id": f"local-fallback-{int(time.time())}",
                "duration": 0,
                "format": "mp4",
                "local_path": video_path,
                "error": str(e)
            }
    
    def _generate_signed_download_url(self, upload_result: dict, data: dict) -> str:
        """Generate signed download URL with expiration"""
        asset_url = upload_result["secure_url"]
        
        if self.storage_manager and self.config.get("aggressive_deletion", True):
            # Generate signed URL that expires in 24 hours
            signed_url = self.storage_manager.generate_signed_url(
                asset_url=asset_url,
                expiry_hours=24,
                storage_type=self.config.get("storage_type", "cloudinary")
            )
            return signed_url
        
        return asset_url
    
    def _select_style_profile(self, data: dict) -> dict:
        """Select style profile with caching"""
        requested_style = data.get("style", "").lower()
        
        if self.cache and self.config["model_caching"]:
            cache_key = f"style_profile_{requested_style}"
            cached = self.cache.get_cached_texture(cache_key)
            if cached and isinstance(cached, dict):
                return cached
        
        for key, profile in STYLE_PROFILES.items():
            if requested_style and requested_style in key:
                return profile
        
        profile = STYLE_PROFILES["dreamy_ethereal"]
        
        if self.cache:
            self.cache.cache_texture(cache_key, profile)
        
        return profile
    
    def _get_optimal_resolution(self, data: dict) -> tuple:
        """Get optimal resolution based on config"""
        if self.resolution_manager and self.config["adaptive_resolution"]:
            if self.config.get("preview_enabled", False):
                return self.resolution_manager.get_adaptive_resolution(preview=True)
            
            quality = self.config.get("quality_mode", "balanced")
            return self.resolution_manager.get_adaptive_resolution(quality)
        
        return (1280, 720)
    
    def _generate_optimized_scenes(self, data: dict, style_profile: dict) -> List[dict]:
        """Generate scenes with parallel processing"""
        lyrics = data["lyrics"]
        
        if self.parallel_processor and self.config["parallel_processing"] and len(lyrics) > 3:
            logger.info("Using parallel scene generation...")
            return self.parallel_processor.parallel_generate_scenes(
                lyrics, 
                style_profile,
                max_workers=4
            )
        else:
            logger.info("Using sequential scene generation...")
            return generate_styled_scenes(data, style_profile)
    
    def _create_optimized_video(self, scenes: List[dict], data: dict, 
                               style_profile: dict, target_size: tuple) -> str:
        """Create video with optimized encoding"""
        logger.info(f"Creating optimized video at {target_size[0]}x{target_size[1]}...")
        
        temp_dir = tempfile.mkdtemp()
        clips = []
        
        for i, scene in enumerate(scenes):
            logger.info(f"Processing scene {i+1}/{len(scenes)}")
            
            bg_clip = create_background_clip(scene, target_size, temp_dir, i)
            text_clip = create_professional_text_overlay(scene, target_size)
            
            if self.interpolator and self.config["motion_interpolation"]:
                animated_text = self.interpolator.smooth_animation(text_clip, scene)
            else:
                animated_text = apply_professional_animation(text_clip, scene)
            
            final_clip = CompositeVideoClip([bg_clip, animated_text])
            clips.append(final_clip)
            
            bg_clip.close()
            text_clip.close()
            if hasattr(animated_text, 'close'):
                animated_text.close()
        
        output_path = os.path.join(temp_dir, "optimized_output.mp4")
        
        if self.encoder and self.config["optimized_encoding"]:
            quality = self.config.get("quality_mode", "balanced")
            profile = self.encoder.get_encoding_profile(
                quality, 
                self.config.get("preview_enabled", False)
            )
            self.encoder.optimize_video_encoding(clips, output_path, profile)
        else:
            if clips:
                video = mp.concatenate_videoclips(clips, method="compose")
                video.write_videofile(
                    output_path,
                    fps=24,
                    codec="libx264",
                    audio_codec=None,
                    remove_temp=True,
                    verbose=False,
                    logger=None,
                    threads=4,
                    preset='fast',
                    bitrate='5000k'
                )
                video.close()
        
        for clip in clips:
            if hasattr(clip, 'close'):
                clip.close()
        
        gc.collect()
        
        logger.info(f"Optimized video created: {output_path}")
        return output_path
    
    def _get_performance_metrics(self) -> dict:
        """Calculate performance metrics"""
        total_time = self.metrics["end_time"] - self.metrics["start_time"]
        
        try:
            if torch and torch.cuda.is_available():
                gpu_usage = torch.cuda.memory_allocated() / torch.cuda.max_memory_allocated() * 100
            else:
                gpu_usage = 0
        except:
            gpu_usage = 0
        
        memory_reduction = 2.0 if self.config["enable_quantization"] else 1.0
        if self.config["adaptive_resolution"]:
            memory_reduction *= 1.5
        
        metrics = {
            "total_time": round(total_time, 2),
            "gpu_usage": round(gpu_usage, 1),
            "memory_reduction_factor": round(memory_reduction, 1),
            "optimizations_enabled": sum(1 for v in self.config.values() if v)
        }
        
        # Add storage metrics if available
        if self.metrics.get("storage_usage"):
            metrics["storage_usage"] = self.metrics["storage_usage"]
        
        return metrics

# ============================================
# KEYWORD EXTRACTION FOR LYRIC PROMPTS
# ============================================

class LyricKeywordExtractor:
    """Fast, lightweight keyword extraction for lyric prompts"""
    
    def __init__(self):
        self.initialized = False
        self.rake = None
        
        if RAKE_AVAILABLE:
            try:
                self.rake = Rake()
                self.initialized = True
                logger.info("RAKE-NLTK keyword extractor initialized")
            except Exception as e:
                logger.warning(f"RAKE initialization failed: {e}")
                self.initialized = False
        else:
            logger.warning("RAKE-NLTK not available, keyword extraction will be limited")
    
    def extract_keywords(self, lyric_text: str, max_keywords: int = 5) -> List[str]:
        """
        Extract top keywords from lyric text
        """
        if not self.initialized or not lyric_text or len(lyric_text.strip()) < 3:
            return self._simple_keyword_extraction(lyric_text, max_keywords)
        
        try:
            text = lyric_text.strip()
            self.rake.extract_keywords_from_text(text)
            ranked_phrases = self.rake.get_ranked_phrases()
            
            keywords = []
            for phrase in ranked_phrases[:max_keywords]:
                phrase = phrase.strip().lower()
                if len(phrase) > 2:
                    keywords.append(phrase)
            
            logger.debug(f"Extracted keywords from lyric: {keywords}")
            
            if not keywords:
                return self._simple_keyword_extraction(lyric_text, max_keywords)
            
            return keywords
            
        except Exception as e:
            logger.warning(f"RAKE keyword extraction failed: {e}")
            return self._simple_keyword_extraction(lyric_text, max_keywords)
    
    def _simple_keyword_extraction(self, lyric_text: str, max_keywords: int = 5) -> List[str]:
        """Simple keyword extraction fallback when RAKE is not available"""
        if not lyric_text:
            return []
        
        stop_words = {
            'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
            'should', 'may', 'might', 'must', 'can', 'could', 'i', 'you', 'he',
            'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them', 'my',
            'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'hers',
            'ours', 'theirs', 'this', 'that', 'these', 'those', 'am', 'pm'
        }
        
        import re
        words = re.findall(r'\b[a-z]{3,}\b', lyric_text.lower())
        
        keywords = []
        for word in words:
            if word not in stop_words and word not in keywords:
                keywords.append(word)
        
        return keywords[:max_keywords]
    
    def extract_adjectives_nouns(self, lyric_text: str, max_keywords: int = 5) -> List[str]:
        """
        Extract descriptive keywords (focusing on adjectives and nouns)
        """
        return self.extract_keywords(lyric_text, max_keywords)

# ============================================
# OPTIMIZED UTILITY FUNCTIONS
# ============================================

@lru_cache(maxsize=100)
def optimized_calculate_duration(lyric_text: str, bpm: int = 120) -> float:
    """Cached duration calculation"""
    words = len(lyric_text.split())
    beats = max(1, words / 4)
    seconds_per_beat = 60.0 / max(1, bpm)
    duration = beats * seconds_per_beat
    return max(duration, 1.0)

def optimized_encode_image(img: Image.Image, quality: int = 85) -> str:
    """Optimized image encoding with compression"""
    buffered = BytesIO()
    
    try:
        img.save(buffered, format="WEBP", quality=quality, optimize=True)
        mime_type = "image/webp"
    except:
        img.save(buffered, format="PNG", optimize=True)
        mime_type = "image/png"
    
    img_base64 = base64.b64encode(buffered.getvalue()).decode()
    return f"data:{mime_type};base64,{img_base64}"

def encode_image(img: Image.Image) -> str:
    """Encode PIL Image to base64 string"""
    return optimized_encode_image(img)

# ============================================
# STYLE PROFILES
# ============================================

STYLE_PROFILES = {
    "dreamy_ethereal": {
        "name": "Dreamy Ethereal",
        "description": "Soft focus, pastel tones, glowing volumetric light",
        "t2v_keywords": [
            "soft focus cinematography",
            "pastel color palette",
            "volumetric lighting",
            "subtle lens flare",
            "slow motion ethereal"
        ],
        "mood_tag": "MOOD_ETHEREAL",
        "animation_tag": "ANIMATION_WOBBLE_SPRING",
        "font_tag": "FONT_SERIF_THIN",
        "effect_tag": "EFFECT_CHROMA_LEAK",
        "color_tag": "COLOR_PASTEL_PEACH",
        "intensity": "low",
        "bpm_range": [60, 120],
        "suitable_moods": ["romantic", "melancholic", "dreamy", "peaceful", "nostalgic"]
    },
    "minimalist_typography": {
        "name": "Minimalist Typography",
        "description": "Clean typography and composition",
        "t2v_keywords": [
            "clean neutral background",
            "soft flat lighting",
            "subtle texture"
        ],
        "mood_tag": "MOOD_CLEAN",
        "animation_tag": "ANIMATION_SLIDE_SNAP",
        "font_tag": "FONT_GEOMETRIC_THIN",
        "effect_tag": "EFFECT_NONE",
        "color_tag": "COLOR_MONOCHROME_HIGH",
        "intensity": "low",
        "bpm_range": [70, 130],
        "suitable_moods": ["clean", "focused", "calm", "minimal", "elegant"]
    },
    "cyberpunk_glitch": {
        "name": "Cyberpunk Glitch",
        "description": "Neon glitch aesthetics with digital artifacts",
        "t2v_keywords": [
            "cyberpunk aesthetic",
            "neon lighting",
            "glitch effect",
            "holographic interface",
            "data visualization"
        ],
        "mood_tag": "MOOD_EDGY",
        "animation_tag": "ANIMATION_SHATTER_COLLISION",
        "font_tag": "FONT_TECH_BOLD",
        "effect_tag": "EFFECT_GLITCH",
        "color_tag": "COLOR_NEON_DARK",
        "intensity": "high",
        "bpm_range": [120, 180],
        "suitable_moods": ["energetic", "anxious", "futuristic", "rebellious", "digital"]
    },
    "vintage_film": {
        "name": "Vintage Film",
        "description": "Film grain, subtle burns, retro aesthetics",
        "t2v_keywords": [
            "16mm film grain",
            "vintage super 8",
            "film burn effect",
            "retro cinematography",
            "analog texture"
        ],
        "mood_tag": "MOOD_NOSTALGIC",
        "animation_tag": "ANIMATION_JITTER_DAMP",
        "font_tag": "FONT_SERIF_CLASSIC",
        "effect_tag": "EFFECT_FILM_GRAIN",
        "color_tag": "COLOR_VINTAGE_FADE",
        "intensity": "medium",
        "bpm_range": [80, 140],
        "suitable_moods": ["nostalgic", "warm", "melancholic", "romantic", "retro"]
    },
    "lofi_aesthetic": {
        "name": "Lo-fi Aesthetic",
        "description": "VHS effects, chill vibes, imperfect textures",
        "t2v_keywords": [
            "VHS effect",
            "crushed blacks",
            "analog warmth",
            "lo-fi aesthetic",
            "home video"
        ],
        "mood_tag": "MOOD_CHILL",
        "animation_tag": "ANIMATION_LOFI_WOBBLE",
        "font_tag": "FONT_HANDWRITTEN",
        "effect_tag": "EFFECT_VHS",
        "color_tag": "COLOR_LOFI",
        "intensity": "medium",
        "bpm_range": [70, 100],
        "suitable_moods": ["chill", "calm", "relaxed", "intimate", "cozy"]
    },
    "kinetic_typography": {
        "name": "Kinetic Typography",
        "description": "Dynamic text movement synchronized to audio",
        "t2v_keywords": [
            "kinetic typography",
            "text animation",
            "motion graphics",
            "dynamic composition",
            "graphic design"
        ],
        "mood_tag": "MOOD_DYNAMIC",
        "animation_tag": "ANIMATION_TYPE_PULSE",
        "font_tag": "FONT_BOLD_MODERN",
        "effect_tag": "EFFECT_MOTION_BLUR",
        "color_tag": "COLOR_HIGH_CONTRAST",
        "intensity": "medium",
        "bpm_range": [90, 150],
        "suitable_moods": ["energetic", "powerful", "dramatic", "confident", "uplifting"]
    },
    "particle_abstract": {
        "name": "Particle Abstract",
        "description": "Abstract particle systems, fluid dynamics",
        "t2v_keywords": [
            "abstract particles",
            "fluid simulation",
            "smoke effects",
            "nebula clouds",
            "organic motion"
        ],
        "mood_tag": "MOOD_ABSTRACT",
        "animation_tag": "ANIMATION_PARTICLE_DECAY",
        "font_tag": "FONT_GEOMETRIC",
        "effect_tag": "EFFECT_PARTICLE",
        "color_tag": "COLOR_GRADIENT_DARK",
        "intensity": "medium",
        "bpm_range": [60, 140],
        "suitable_moods": ["ethereal", "mysterious", "flowing", "hypnotic", "atmospheric"]
    },
    "brutalist_bold": {
        "name": "Brutalist Bold",
        "description": "Raw concrete textures, bold typography",
        "t2v_keywords": [
            "brutalist architecture",
            "concrete texture",
            "bold typography",
            "monolithic forms",
            "high contrast"
        ],
        "mood_tag": "MOOD_BOLD",
        "animation_tag": "ANIMATION_SLIDE_INERTIA",
        "font_tag": "FONT_ARCHITECTURAL",
        "effect_tag": "EFFECT_GRUNGE",
        "color_tag": "COLOR_MONOCHROME_LOW",
        "intensity": "high",
        "bpm_range": [100, 160],
        "suitable_moods": ["bold", "powerful", "raw", "industrial", "confrontational"]
    },
    "floating_dream": {
        "name": "Floating Dream",
        "description": "Weightless floating animation, soft physics",
        "t2v_keywords": [
            "floating in space",
            "zero gravity",
            "soft movement",
            "dream sequence",
            "slow motion"
        ],
        "mood_tag": "MOOD_DREAMY",
        "animation_tag": "ANIMATION_FLOAT_FADE_PHYSICS",
        "font_tag": "FONT_SERIF_DELICATE",
        "effect_tag": "EFFECT_BLOOM",
        "color_tag": "COLOR_PASTEL_BLUE",
        "intensity": "low",
        "bpm_range": [50, 90],
        "suitable_moods": ["dreamy", "peaceful", "floaty", "meditative", "serene"]
    },
    "glitch_core": {
        "name": "Glitch Core",
        "description": "Digital distortion, data moshing, corruption",
        "t2v_keywords": [
            "data moshing",
            "digital corruption",
            "pixel sorting",
            "error artifacts",
            "broken transmission"
        ],
        "mood_tag": "MOOD_GLITCH",
        "animation_tag": "ANIMATION_SHATTER_SHIFT",
        "font_tag": "FONT_DISTORTED",
        "effect_tag": "EFFECT_DATA_MOSH",
        "color_tag": "COLOR_DIGITAL",
        "intensity": "high",
        "bpm_range": [130, 200],
        "suitable_moods": ["chaotic", "anxious", "digital", "futuristic", "disorienting"]
    }
}

# ============================================
# FONT STYLE MAPPING
# ============================================

FONT_STYLE_MAP = {
    "FONT_SERIF_THIN": {
        "name": "Arial",
        "size": 90,
        "color_tag": "COLOR_PASTEL_PEACH",
        "kerning": 0,
        "stroke_width": 0,
        "shadow": False
    },
    "FONT_GEOMETRIC_THIN": {
        "name": "Arial",
        "size": 120,
        "color_tag": "COLOR_MONOCHROME_HIGH",
        "kerning": 8,
        "stroke_width": 0,
        "shadow": False
    }
}

# ============================================
# COLOR PALETTE MAPPING
# ============================================

COLOR_PALETTE_MAP = {
    "COLOR_PASTEL_PEACH": {
        "primary": "#F8D8C9",
        "secondary": "#B0E0E6",
        "accent": "#FFF5EE",
        "background": "#F5F5F5",
        "shadow": "#E6E6FA"
    },
    "COLOR_MONOCHROME_HIGH": {
        "primary": "#FFFFFF",
        "secondary": "#CCCCCC",
        "accent": "#000000",
        "background": "#F5F5F5",
        "shadow": "#333333"
    }
}

# ============================================
# ANIMATION LIBRARY
# ============================================

class AnimationLibrary:
    """Library of animation functions for different styles"""
    
    @staticmethod
    def _safe_float(value):
        """Safely convert any value (function or number) to a float."""
        if callable(value):
            try:
                return float(value())
            except:
                return 0.0
        try:
            return float(value)
        except:
            return 0.0

    @staticmethod
    def _safe_time_value(t):
        """Safely convert t to numeric value, handling MoviePy callables"""
        return AnimationLibrary._safe_float(t)
    
    @staticmethod
    def _get_clip_size(clip):
        """Safely get clip dimensions, handling callable clip.size"""
        try:
            if hasattr(clip, 'w') and hasattr(clip, 'h') and clip.w and clip.h:
                return (clip.w, clip.h)
            
            if callable(clip.size):
                size_result = clip.size()
                if isinstance(size_result, tuple) and len(size_result) == 2:
                    return size_result
            elif isinstance(clip.size, (tuple, list)) and len(clip.size) == 2:
                return clip.size
                
            return (500, 200)
        except:
            return (500, 200)
    
    @staticmethod
    def animate_wobble_pop(clip, duration, intensity: str = "low") -> mp.TextClip:
        """Handwritten Doodle: Wobble and pop animation with enhanced effects"""
        try:
            duration_val = float(duration) if not callable(duration) else float(duration(0))
        except:
            duration_val = 3.0
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        try:
            if callable(clip.size):
                size_result = clip.size()
                clip_w, clip_h = size_result if isinstance(size_result, (tuple, list)) and len(size_result) >= 2 else (500, 200)
            else:
                clip_w, clip_h = clip.size if hasattr(clip.size, '__len__') and len(clip.size) >= 2 else (500, 200)
        except:
            clip_w, clip_h = 500, 200
        
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            try:
                t_val = float(t) if not callable(t) else float(t())
                if t_val < 0.3:
                    pop_factor = 1.0 - (t_val / 0.3) * 0.2
                else:
                    pop_factor = 0.8 + 0.2 * math.sin(t_val * 2)
                
                dx = int(math.sin(t_val * 8) * 8 * pop_factor)
                dy = int(math.cos(t_val * 6) * 6 * pop_factor)
                return (center_x + dx, center_y + dy)
            except:
                return (center_x, center_y)
        
        try:
            animated = animated.set_position(position_func)
            animated = animated.fadein(0.3).fadeout(0.3)
        except Exception as e:
            logger.warning(f"Wobble pop animation failed: {e}")
            animated = animated.set_position(('center', 'center')).fadein(0.5).fadeout(0.5)
        
        return animated
    
    @staticmethod
    def animate_jitter_shake(clip, duration, intensity: str = "high") -> mp.TextClip:
        """Industrial Grunge: Aggressive jitter and shake animation"""
        duration_val = AnimationLibrary._safe_float(duration)
        intensity_factor = 1.5 if intensity == "high" else 0.8
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            jitter_x = int(math.sin(t_val * 15) * 12 * intensity_factor)
            jitter_y = int(math.cos(t_val * 18) * 8 * intensity_factor)
            return (center_x + jitter_x, center_y + jitter_y)
        
        try:
            animated = animated.set_position(position_func)
            animated = animated.fadein(0.1).fadeout(0.1)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_wipe_type(clip, duration, intensity: str = "medium") -> mp.TextClip:
        """Retro 80s: Typewriter wipe animation"""
        duration_val = AnimationLibrary._safe_float(duration)
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            if t_val < 0.4:
                slide_progress = t_val / 0.4
                x_offset = int((1 - slide_progress) * -150)
                return (center_x + x_offset, center_y)
            return (center_x, center_y)
        
        try:
            animated = animated.set_position(position_func)
            animated = animated.fadein(0.1)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_shatter_shift(clip, duration, intensity: str = "extreme") -> mp.TextClip:
        """Dynamic Glitch: Shatter and shift animation"""
        duration_val = AnimationLibrary._safe_float(duration)
        intensity_factor = 2.5 if intensity == "extreme" else 1.2
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            glitch_x = int(
                math.sin(t_val * 25) * 15 * intensity_factor +
                math.sin(t_val * 40) * 8 * intensity_factor
            )
            glitch_y = int(
                math.cos(t_val * 20) * 10 * intensity_factor +
                math.cos(t_val * 35) * 5 * intensity_factor
            )
            return (center_x + glitch_x, center_y + glitch_y)
        
        try:
            animated = animated.set_position(position_func)
            animated = animated.fadein(0.05).fadeout(0.05)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_slide_snap(clip, duration, intensity: str = "low") -> mp.TextClip:
        """Minimalist: Slide in/out with rapid position snap"""
        duration_val = AnimationLibrary._safe_float(duration)
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            if t_val < 0.25:
                progress = t_val / 0.25
                x_offset = int((1 - progress) * -200)
                return (center_x + x_offset, center_y)
            elif t_val > duration_val - 0.25:
                progress = (duration_val - t_val) / 0.25
                x_offset = int((1 - progress) * 200)
                return (center_x + x_offset, center_y)
            else:
                return (center_x, center_y)
        
        try:
            animated = animated.set_position(position_func)
            animated = animated.fadein(0.2).fadeout(0.2)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_depth_fluid(clip, duration, intensity: str = "medium") -> mp.TextClip:
        """Cinematic: Slow kinetic movement in 3D space"""
        duration_val = AnimationLibrary._safe_float(duration)
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            x_offset = int(math.sin(t_val * 0.8) * 40)
            y_offset = int(math.cos(t_val * 0.6) * 25)
            return (center_x + x_offset, center_y + y_offset)
        
        try:
            animated = animated.set_position(position_func)
            fade_duration = min(1.0, duration_val * 0.3)
            animated = animated.fadein(fade_duration).fadeout(fade_duration)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_type_flicker(clip, duration, intensity: str = "medium") -> mp.TextClip:
        """Lo-Fi: Typewriter effect with screen flicker"""
        duration_val = AnimationLibrary._safe_float(duration)
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            if int(t_val * 15) % 7 == 0:
                return (center_x + 1, center_y + 1)
            return (center_x, center_y)
        
        try:
            animated = animated.set_position(position_func)
            if duration_val > 1.0:
                animated = animated.fadein(0.5)
            else:
                animated = animated.fadein(duration_val * 0.5)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_particle_dissolve(clip, duration, intensity: str = "medium") -> mp.TextClip:
        """Space/Cosmic: Particle dissolve effect"""
        duration_val = AnimationLibrary._safe_float(duration)
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            float_offset = int(math.sin(t_val * 1.2) * 15)
            return (center_x, center_y + float_offset)
        
        try:
            animated = animated.set_position(position_func)
            fade_in = min(1.0, duration_val * 0.3)
            fade_out = min(0.5, duration_val * 0.2)
            animated = animated.fadein(fade_in).fadeout(fade_out)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_pulse_morph(clip, duration, intensity: str = "high") -> mp.TextClip:
        """Abstract: Pulsing and morphing with the beat"""
        duration_val = AnimationLibrary._safe_float(duration)
        intensity_factor = 1.5 if intensity == "high" else 1.0
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        clip_w, clip_h = AnimationLibrary._get_clip_size(clip)
        screen_w, screen_h = 1920, 1080
        center_x = (screen_w - clip_w) / 2
        center_y = (screen_h - clip_h) / 2
        
        def position_func(t):
            t_val = AnimationLibrary._safe_time_value(t)
            x_wobble = int(math.sin(t_val * 4) * 20 * intensity_factor)
            y_wobble = int(math.cos(t_val * 3) * 15 * intensity_factor)
            return (center_x + x_wobble, center_y + y_wobble)
        
        try:
            animated = animated.set_position(position_func)
            animated = animated.fadein(0.2).fadeout(0.2)
        except:
            animated = animated.set_position(('center', 'center'))
        
        return animated
    
    @staticmethod
    def animate_simple_fade(clip, duration, intensity: str = "low") -> mp.TextClip:
        """Simple fade in/out animation (Standard)"""
        duration_val = AnimationLibrary._safe_float(duration)
        
        animated = clip.copy()
        animated = animated.set_duration(duration_val)
        
        fade_duration = min(0.5, duration_val * 0.3)
        
        return animated.fadein(fade_duration).fadeout(fade_duration)

ANIMATION_FUNCTION_MAP = {
    "float_fade": AnimationLibrary.animate_simple_fade,
    "slide": AnimationLibrary.animate_slide_snap,
    "typewriter": AnimationLibrary.animate_type_flicker,
    "bounce": AnimationLibrary.animate_wobble_pop,
    "glitch": AnimationLibrary.animate_shatter_shift,
    "particles": AnimationLibrary.animate_particle_dissolve,
    
    "float_fade_physics": AnimationLibrary.animate_simple_fade,
    "jitter_damp": AnimationLibrary.animate_jitter_shake,
    "type_pulse": AnimationLibrary.animate_type_flicker,
    "wobble_spring": AnimationLibrary.animate_wobble_pop,
    "shatter_collision": AnimationLibrary.animate_shatter_shift,
    "slide_inertia": AnimationLibrary.animate_slide_snap,
    "depth_gravity": AnimationLibrary.animate_depth_fluid,
    "lofi_wobble": AnimationLibrary.animate_type_flicker,
    "particle_decay": AnimationLibrary.animate_particle_dissolve,
    "abstract_breath": AnimationLibrary.animate_pulse_morph,
    
    "ANIMATION_FLOAT_FADE": AnimationLibrary.animate_simple_fade,
    "ANIMATION_WOBBLE_POP": AnimationLibrary.animate_wobble_pop,
}

# ============================================
# EFFECT LIBRARY
# ============================================

class EffectLibrary:
    """Library of visual effects for different styles"""
    
    @staticmethod
    def apply_chroma_leak(image: Image.Image) -> Image.Image:
        """Dreamy Ethereal: Chromatic aberration and light leaks"""
        r, g, b = image.split()
        offset = 2
        r = r.transform(image.size, Image.AFFINE, (1, 0, offset, 0, 1, 0))
        b = b.transform(image.size, Image.AFFINE, (1, 0, -offset, 0, 1, 0))
        result = Image.merge("RGB", (r, g, b))
        
        leak = Image.new("RGBA", image.size, (255, 200, 200, 30))
        leak_draw = ImageDraw.Draw(leak)
        for i in range(10):
            x = random.randint(0, image.width)
            y = random.randint(0, image.height)
            radius = random.randint(50, 200)
            leak_draw.ellipse([x, y, x+radius, y+radius], 
                            fill=(255, 255, 200, random.randint(10, 40)))
        
        result = Image.alpha_composite(result.convert("RGBA"), leak)
        result = result.filter(ImageFilter.GaussianBlur(radius=1))
        enhancer = ImageEnhance.Brightness(result)
        result = enhancer.enhance(1.05)
        
        return result
    
    @staticmethod
    def apply_no_effect(image: Image.Image) -> Image.Image:
        """Minimalist: No effect, pure clean image"""
        return image

EFFECT_TEXTURE_MAP = {
    "EFFECT_CHROMA_LEAK": EffectLibrary.apply_chroma_leak,
    "EFFECT_NONE": EffectLibrary.apply_no_effect
}

# ============================================
# BACKGROUND GENERATION
# ============================================

def generate_dreamy_ethereal_background(lyric: dict) -> str:
    """Generate Dreamy Ethereal background"""
    img = Image.new("RGB", (1920, 1080), color=(245, 245, 245))
    draw = ImageDraw.Draw(img)
    
    for y in range(1080):
        factor = y / 1080
        r = int(245 - factor * 100)
        g = int(245 - factor * 120)
        b = int(255 - factor * 150)
        draw.line([(0, y), (1920, y)], fill=(r, g, b))
    
    for _ in range(300):
        x = random.randint(0, 1920)
        y = random.randint(0, 1080)
        radius = random.randint(10, 50)
        opacity = random.randint(30, 100)
        color = (255, 255, 255, opacity)
        draw.ellipse([x, y, x+radius, y+radius], fill=color)
    
    flare_x = random.randint(300, 1620)
    flare_y = random.randint(200, 800)
    for i in range(5, 0, -1):
        radius = i * 40
        opacity = i * 10
        draw.ellipse([flare_x-radius, flare_y-radius, flare_x+radius, flare_y+radius],
                    fill=(255, 255, 200, opacity))
    
    img = EffectLibrary.apply_chroma_leak(img)
    return encode_image(img)

def generate_minimalist_background(lyric: dict) -> str:
    """Generate Minimalist background"""
    colors = COLOR_PALETTE_MAP["COLOR_MONOCHROME_HIGH"]
    img = Image.new("RGB", (1920, 1080), color=colors["background"])
    draw = ImageDraw.Draw(img)
    
    for _ in range(5000):
        x = random.randint(0, 1920)
        y = random.randint(0, 1080)
        brightness_variation = random.randint(-10, 10)
        base_rgb = ImageColor.getrgb(colors["background"])
        current_color = tuple(max(0, min(255, c + brightness_variation)) for c in base_rgb)
        draw.point((x, y), fill=current_color)
    
    for _ in range(random.randint(3, 8)):
        start_x = random.randint(100, 1820)
        start_y = random.randint(100, 980)
        end_x = start_x + random.randint(200, 500)
        end_y = start_y
        
        if random.random() < 0.5:
            end_y = start_y + random.randint(200, 500)
        
        line_width = random.randint(1, 3)
        line_color = colors["shadow"]
        draw.line([(start_x, start_y), (end_x, end_y)], 
                 fill=line_color, width=line_width)
    
    img = EffectLibrary.apply_no_effect(img)
    return encode_image(img)

def generate_styled_background(lyric: dict, style_profile: dict) -> str:
    """Generate background with AI-powered unique textures"""
    
    style_key = list(STYLE_PROFILES.keys())[0]
    
    try:
        mood = lyric.get("mood", "neutral")
        lyric_text = lyric.get("text", "")
        
        # Create texture prompt
        texture_templates = {
            "dreamy_ethereal": [
                f"Ethereal dreamy texture for '{lyric_text}', {mood} mood, soft volumetric lighting, pastel nebula, particle effects, medium intensity",
                f"Abstract dreamy background with {mood} atmosphere, ethereal mist, light rays, organic flowing shapes, no text",
            ]
        }
        
        import random as rand
        prompts = texture_templates.get(style_key, texture_templates["dreamy_ethereal"])
        ai_texture_prompt = rand.choice(prompts)
        
        logger.debug(f"Generated texture prompt: {ai_texture_prompt[:100]}...")
        
        # Try to generate AI texture if HF token is available
        hf_token = os.getenv("HF_TOKEN")
        if hf_token and HF_INFERENCE_AVAILABLE:
            try:
                from io import BytesIO
                
                client = InferenceClient(api_key=hf_token)
                height, width = 1080, 1920
                
                image = client.text_to_image(
                    prompt=ai_texture_prompt,
                    model="black-forest-labs/FLUX.1-dev",
                    height=height,
                    width=width
                )
                
                buffered = BytesIO()
                image.save(buffered, format="PNG")
                return base64.b64encode(buffered.getvalue()).decode()
            except Exception as e:
                logger.warning(f"AI texture generation failed: {str(e)}")
        
        logger.warning("AI texture generation unavailable, using fallback")
        return generate_procedural_fallback_background(lyric, style_profile)
        
    except Exception as e:
        logger.error(f"Background generation failed: {str(e)}")
        return generate_procedural_fallback_background(lyric, style_profile)

def generate_procedural_fallback_background(lyric: dict, style_profile: dict) -> str:
    """Procedural fallback with high variability (NOT template fatigue)"""
    
    style_name = style_profile.get("name", "dreamy_ethereal")
    
    seed = hash(lyric.get("text", "")) % (2**31)
    random.seed(seed)
    
    if "dreamy" in style_name.lower():
        return generate_dreamy_ethereal_background_varied(lyric, seed)
    elif "minimal" in style_name.lower():
        return generate_minimalist_background_varied(lyric, seed)
    elif "cosmic" in style_name.lower():
        return generate_dreamy_ethereal_background_varied(lyric, seed)
    
    return generate_dreamy_ethereal_background_varied(lyric, seed)

def generate_dreamy_ethereal_background_varied(lyric: dict, seed: int) -> str:
    """High-variability dreamy background based on lyric content"""
    random.seed(seed)
    
    img = Image.new("RGB", (1920, 1080))
    draw = ImageDraw.Draw(img, 'RGBA')
    
    base_colors = [
        ((245, 220, 200), (200, 240, 255)),
        ((220, 200, 245), (240, 200, 220)),
        ((200, 245, 230), (245, 230, 200)),
        ((240, 220, 255), (220, 255, 240)),
    ]
    
    start_color, end_color = random.choice(base_colors)
    
    for y in range(1080):
        factor = y / 1080
        r = int(start_color[0] * (1 - factor) + end_color[0] * factor)
        g = int(start_color[1] * (1 - factor) + end_color[1] * factor)
        b = int(start_color[2] * (1 - factor) + end_color[2] * factor)
        draw.line([(0, y), (1920, y)], fill=(r, g, b))
    
    lyric_text = lyric.get("text", "").lower()
    particle_count = random.randint(150, 400)
    particle_types = []
    
    if any(word in lyric_text for word in ["light", "bright", "shine", "glow"]):
        particle_types = ["rays", "flares"]
    elif any(word in lyric_text for word in ["dark", "night", "shadow", "moon"]):
        particle_types = ["sparkles", "stars"]
    elif any(word in lyric_text for word in ["float", "fly", "soar", "drift"]):
        particle_types = ["bubbles", "floats"]
    else:
        particle_types = ["circles", "sparkles", "rays"]
    
    for _ in range(particle_count):
        x = random.randint(0, 1920)
        y = random.randint(0, 1080)
        
        particle_type = random.choice(particle_types)
        
        if particle_type == "rays":
            draw.line([(x, y), (x + random.randint(-50, 50), y + random.randint(-100, 100))],
                     fill=(255, 255, 255, random.randint(20, 80)), width=random.randint(1, 3))
        elif particle_type == "flares":
            radius = random.randint(5, 40)
            draw.ellipse([x-radius, y-radius, x+radius, y+radius],
                        fill=(255, 250, 200, random.randint(10, 60)))
        elif particle_type == "sparkles":
            size = random.randint(1, 4)
            draw.ellipse([x-size, y-size, x+size, y+size],
                        fill=(255, 255, 255, random.randint(50, 200)))
        elif particle_type == "stars":
            draw.polygon([(x, y-5), (x+3, y), (x, y+5), (x-3, y)],
                        fill=(200, 200, 255, random.randint(80, 200)))
        elif particle_type == "bubbles":
            radius = random.randint(10, 50)
            draw.ellipse([x-radius, y-radius, x+radius, y+radius],
                        outline=(255, 255, 255, random.randint(30, 100)), width=2)
        else:
            radius = random.randint(5, 30)
            draw.ellipse([x-radius, y-radius, x+radius, y+radius],
                        fill=(255, 255, 255, random.randint(20, 80)))
    
    if "sad" in lyric_text or "tear" in lyric_text or "lonely" in lyric_text:
        for _ in range(50):
            x = random.randint(0, 1920)
            for i in range(random.randint(3, 10)):
                y = random.randint(0, 1080)
                draw.line([(x, y), (x + random.randint(-5, 5), y + random.randint(10, 30))],
                         fill=(200, 220, 255, random.randint(10, 40)), width=1)
    
    if "happy" in lyric_text or "joy" in lyric_text or "dance" in lyric_text:
        colors = [(255, 100, 100), (255, 200, 100), (255, 255, 100), 
                 (100, 255, 100), (100, 100, 255), (200, 100, 255)]
        for _ in range(100):
            x = random.randint(0, 1920)
            y = random.randint(0, 1080)
            color = random.choice(colors)
            draw.ellipse([x-10, y-10, x+10, y+10], fill=(*color, random.randint(20, 60)))
    
    return encode_image(img)

def generate_minimalist_background_varied(lyric: dict, seed: int) -> str:
    """High-variability minimalist background based on lyric content"""
    random.seed(seed)
    colors = COLOR_PALETTE_MAP["COLOR_MONOCHROME_HIGH"]
    img = Image.new("RGB", (1920, 1080), color=colors["background"])
    draw = ImageDraw.Draw(img)

    for _ in range(5000):
        x = random.randint(0, 1920)
        y = random.randint(0, 1080)
        brightness_variation = random.randint(-10, 10)
        base_rgb = ImageColor.getrgb(colors["background"])
        current_color = tuple(max(0, min(255, c + brightness_variation)) for c in base_rgb)
        draw.point((x, y), fill=current_color)

    for _ in range(random.randint(3, 8)):
        start_x = random.randint(100, 1820)
        start_y = random.randint(100, 980)
        end_x = start_x + random.randint(200, 500)
        end_y = start_y

        if random.random() < 0.5:
            end_y = start_y + random.randint(200, 500)

        line_width = random.randint(1, 3)
        line_color = colors["shadow"]
        draw.line([(start_x, start_y), (end_x, end_y)], 
                 fill=line_color, width=line_width)

    lyric_text = lyric.get("text", "").lower()
    if "circle" in lyric_text or "round" in lyric_text:
        for _ in range(10):
            x = random.randint(100, 1820)
            y = random.randint(100, 980)
            radius = random.randint(20, 80)
            draw.ellipse([x-radius, y-radius, x+radius, y+radius], fill=colors["accent"])
    if "line" in lyric_text or "straight" in lyric_text:
        for _ in range(5):
            x1 = random.randint(100, 1820)
            y1 = random.randint(100, 980)
            x2 = x1 + random.randint(-200, 200)
            y2 = y1 + random.randint(-200, 200)
            draw.line([(x1, y1), (x2, y2)], fill=colors["primary"], width=2)

    img = EffectLibrary.apply_no_effect(img)
    return encode_image(img)

def generate_cosmic_background_varied(lyric: dict, seed: int) -> str:
    """High-variability cosmic background based on lyric content"""
    from PIL import Image, ImageDraw
    import random
    import base64
    
    def encode_image(img):
        from io import BytesIO
        buffered = BytesIO()
        img.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode()
    
    random.seed(seed)
    
    img = Image.new("RGB", (1920, 1080))
    draw = ImageDraw.Draw(img, 'RGBA')
    
    start_color = (10, 10, 30)
    end_color = (50, 20, 80)
    
    for y in range(1080):
        factor = y / 1080
        r = int(start_color[0] * (1 - factor) + end_color[0] * factor)
        g = int(start_color[1] * (1 - factor) + end_color[1] * factor)
        b = int(start_color[2] * (1 - factor) + end_color[2] * factor)
        draw.line([(0, y), (1920, y)], fill=(r, g, b))
    
    star_count = random.randint(200, 400)
    for _ in range(star_count):
        x = random.randint(0, 1920)
        y = random.randint(0, 1080)
        size = random.randint(1, 3)
        brightness = random.randint(100, 255)
        draw.ellipse([x-size, y-size, x+size, y+size],
                    fill=(brightness, brightness, brightness, brightness))
    
    nebula_count = random.randint(3, 8)
    for _ in range(nebula_count):
        x = random.randint(200, 1720)
        y = random.randint(200, 880)
        radius = random.randint(100, 300)
        color = random.choice([(100, 50, 150), (150, 100, 200), (80, 100, 180)])
        draw.ellipse([x-radius, y-radius, x+radius, y+radius],
                    fill=(*color, random.randint(30, 80)))
    
    lyric_text = lyric.get("text", "").lower()
    if "space" in lyric_text or "star" in lyric_text or "cosmic" in lyric_text:
        particle_count = 300
    else:
        particle_count = 150
    
    for _ in range(particle_count):
        x = random.randint(0, 1920)
        y = random.randint(0, 1080)
        size = random.randint(1, 2)
        draw.ellipse([x-size, y-size, x+size, y+size],
                    fill=(200, 180, 255, random.randint(50, 150)))
    
    return encode_image(img)

class EnhancedLyricKeywordExtractor:
    """Enhanced keyword extraction with POS tagging when available"""
    
    def __init__(self):
        """Initialize the keyword extractor"""
        self.initialized = False
        self.rake = None
        self.nltk_available = False
        
        if RAKE_AVAILABLE:
            try:
                self.rake = Rake()
                self.initialized = True
                logger.info("RAKE-NLTK keyword extractor initialized")
            except Exception as e:
                logger.warning(f"RAKE initialization failed: {e}")
        
        try:
            import nltk
            try:
                nltk.data.find('averaged_perceptron_tagger')
            except LookupError:
                nltk.download('averaged_perceptron_tagger', quiet=True)
            try:
                nltk.data.find('punkt')
            except LookupError:
                nltk.download('punkt', quiet=True)
                
            self.nltk_available = True
            logger.info("NLTK POS tagging available")
        except Exception as e:
            logger.warning(f"NLTK initialization failed: {e}")
            self.nltk_available = False
    
    def extract_keywords(self, lyric_text: str, max_keywords: int = 5) -> List[str]:
        """Extract keywords using the best available method"""
        if not lyric_text:
            return []
        
        if self.rake:
            try:
                self.rake.extract_keywords_from_text(lyric_text)
                ranked_phrases = self.rake.get_ranked_phrases()
                keywords = [p.strip().lower() for p in ranked_phrases[:max_keywords] if len(p.strip()) > 2]
                if keywords:
                    return keywords
            except Exception:
                pass
        
        return self._enhanced_keyword_extraction(lyric_text, max_keywords)
    
    def _enhanced_keyword_extraction(self, lyric_text: str, max_keywords: int = 5) -> List[str]:
        """Enhanced keyword extraction with POS awareness"""
        import re
        
        stop_words = {
            'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
            'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
            'should', 'may', 'might', 'must', 'can', 'could'
        }
        
        text = lyric_text.lower()
        text = re.sub(r'[^\w\s]', ' ', text)
        
        words = text.split()
        
        filtered_words = [w for w in words if w not in stop_words and len(w) > 2]
        
        if self.nltk_available:
            try:
                import nltk
                from nltk import pos_tag
                
                tagged = pos_tag(filtered_words)
                
                descriptive_words = []
                for word, tag in tagged:
                    if tag.startswith('NN') or tag.startswith('JJ'):
                        descriptive_words.append(word)
                
                if descriptive_words:
                    unique_words = []
                    for word in descriptive_words:
                        if word not in unique_words:
                            unique_words.append(word)
                    return unique_words[:max_keywords]
                    
            except Exception as e:
                logger.debug(f"POS tagging failed: {e}")
        
        from collections import Counter
        word_freq = Counter(filtered_words)
        most_common = [word for word, _ in word_freq.most_common(max_keywords)]
        
        return most_common

keyword_extractor = EnhancedLyricKeywordExtractor()

class UniquenessValidator:
    @staticmethod
    def calculate_image_hash(image_base64: str) -> str:
        """Calculate perceptual hash to detect similar images"""
        import hashlib
        from PIL import Image, ImageOps
        from io import BytesIO
        
        img_data = image_base64.split(',')[1] if ',' in image_base64 else image_base64
        img = Image.open(BytesIO(base64.b64decode(img_data)))
        
        img = ImageOps.grayscale(img)
        img = img.resize((8, 8))
        
        pixels = list(img.getdata())
        avg = sum(pixels) // len(pixels)
        
        hash_bits = ''.join('1' if pixel > avg else '0' for pixel in pixels)
        return hashlib.md5(hash_bits.encode()).hexdigest()
    
    @staticmethod
    def check_uniqueness(new_image: str, previous_images: List[str], threshold: float = 0.85) -> bool:
        """Check if new image is sufficiently unique"""
        new_hash = UniquenessValidator.calculate_image_hash(new_image)
        
        for prev_image in previous_images:
            prev_hash = UniquenessValidator.calculate_image_hash(prev_image)
            
            similarity = sum(a == b for a, b in zip(new_hash, prev_hash)) / len(new_hash)
            
            if similarity > threshold:
                logger.warning(f"Potential template duplicate detected: {similarity:.2%} similar")
                return False
        
        return True

def calculate_lyric_duration(lyric: dict, bpm: int = 120) -> float:
    """
    Estimate lyric duration based on text length and BPM.
    """
    if "duration" in lyric:
        return float(lyric["duration"])
    words = len(lyric.get("text", "").split())
    beats = max(1, words / 4)
    seconds_per_beat = 60.0 / max(1, bpm)
    duration = beats * seconds_per_beat
    return max(duration, 1.0)

def generate_styled_scenes(data: dict, style_profile: dict) -> List[dict]:
    """Generate scenes with uniqueness validation"""
    scenes = []
    lyrics = data["lyrics"]
    previous_images = []
    
    logger.info(f"Generating scenes with AI-powered unique textures...")
    
    for i, lyric in enumerate(lyrics):
        try:
            max_attempts = 3
            image_base64 = None
            
            for attempt in range(max_attempts):
                cache_key = ModelCache.get_cache_key(
                    lyric.get("text", ""), 
                    style_profile["name"],
                    lyric.get("mood", "neutral")
                )
                
                if cache_key in ModelCache._cache:
                    image_base64 = ModelCache._cache[cache_key]
                    logger.debug(f"Using cached background for lyric {i+1}")
                else:
                    image_base64 = generate_styled_background(lyric, style_profile)
                    if cache_key:
                        ModelCache.cache_texture(cache_key, image_base64)
                
                if UniquenessValidator.check_uniqueness(image_base64, previous_images):
                    previous_images.append(image_base64)
                    break
                
                logger.warning(f"Regenerating scene {i+1} (attempt {attempt+1}) - template detected")
                
                if attempt == max_attempts - 1:
                    logger.warning(f"Could not generate unique background after {max_attempts} attempts")
            
            duration = calculate_lyric_duration(lyric, data.get("bpm", 120))
            
            scene = {
                "id": i + 1,
                "lyric": lyric.get("text", ""),
                "image_url": f"data:image/png;base64,{image_base64}",
                "time": lyric.get("time", sum(s.get("duration", 0) for s in scenes)),
                "duration": duration,
                "style": style_profile["name"],
                "rendering_data": {
                    "font_tag": style_profile["font_tag"],
                    "animation_tag": style_profile["animation_tag"],
                    "effect_tag": style_profile["effect_tag"],
                    "color_tag": style_profile["color_tag"],
                    "intensity": style_profile["intensity"]
                }
            }
            
            scenes.append(scene)
            logger.debug(f"Generated unique scene {i+1}: {lyric.get('text', '')[:30]}...")
            
        except Exception as e:
            logger.error(f"Failed to generate scene {i+1}: {str(e)}")
    
    return scenes

def create_background_clip(scene: dict, target_size: tuple, temp_dir: str, index: int) -> mp.ImageClip:
    """Create background video clip from scene"""
    
    if "image_url" in scene:
        cache_key = hashlib.md5(scene["image_url"].encode()).hexdigest()
        cached_path = OptimizationConfig.BACKGROUND_CACHE.get(cache_key)
        
        if cached_path and os.path.exists(cached_path):
            logger.debug(f"Using cached background for scene {index}")
            return mp.ImageClip(cached_path, duration=scene["duration"])
    
    try:
        if scene.get("image_url") and scene["image_url"].startswith("data:image"):
            img_data = scene["image_url"].split(",")[1]
            img_bytes = base64.b64decode(img_data)
            img = Image.open(BytesIO(img_bytes))
            
            if img.mode == 'RGBA':
                background = Image.new('RGB', img.size, (255, 255, 255))
                background.paste(img, mask=img.split()[-1])
                img = background
            elif img.mode not in ['RGB', 'L']:
                img = img.convert('RGB')
            
            if img.size != target_size:
                if max(img.size) > target_size[0] * 2:
                    resample = Image.Resampling.BILINEAR
                else:
                    resample = Image.Resampling.LANCZOS
                img = img.resize(target_size, resample)
            
            effect_tag = scene["rendering_data"].get("effect_tag")
            if effect_tag and effect_tag in EFFECT_TEXTURE_MAP:
                try:
                    img = EFFECT_TEXTURE_MAP[effect_tag](img)
                except Exception as e:
                    logger.warning(f"Effect application failed: {e}")
            
            scene_path = os.path.join(temp_dir, f"scene_{index}.webp")
            img.save(scene_path, "WEBP", quality=85, optimize=True)
            
            if "image_url" in scene:
                OptimizationConfig.BACKGROUND_CACHE[cache_key] = scene_path
            
            clip = mp.ImageClip(scene_path, duration=scene["duration"])
            return clip
            
    except Exception as e:
        logger.warning(f"Failed to process scene image: {str(e)}")
    
    return create_gradient_background(target_size, scene["duration"], 
                                     scene["rendering_data"].get("color_tag"))

def create_gradient_background(target_size: tuple, duration: float, color_tag: str) -> mp.ImageClip:
    """Create gradient background fallback"""
    colors = COLOR_PALETTE_MAP.get(color_tag, COLOR_PALETTE_MAP["COLOR_PASTEL_PEACH"])
    
    def hex_to_rgb(hex_color):
        hex_color = hex_color.lstrip('#')
        if len(hex_color) == 6:
            return tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
        return (128, 128, 128)
    
    bg_color = hex_to_rgb(colors["background"])
    accent_color = hex_to_rgb(colors["accent"])
    
    img = Image.new("RGB", target_size, color=bg_color)
    draw = ImageDraw.Draw(img)
    
    for y in range(target_size[1]):
        factor = y / target_size[1]
        r = int(bg_color[0] * (1 - factor) + accent_color[0] * factor)
        g = int(bg_color[1] * (1 - factor) + accent_color[1] * factor)
        b = int(bg_color[2] * (1 - factor) + accent_color[2] * factor)
        draw.line([(0, y), (target_size[0], y)], fill=(r, g, b))
    
    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, "gradient_bg.png")
    img.save(temp_path, "PNG")
    
    return mp.ImageClip(temp_path, duration=duration)

def create_professional_text_overlay(scene: dict, target_size: tuple) -> mp.TextClip:
    """Create text overlay with professional styling"""
    rendering_data = scene["rendering_data"]
    font_tag = rendering_data.get("font_tag", "FONT_SERIF_THIN")
    color_tag = rendering_data.get("color_tag", "COLOR_PASTEL_PEACH")
    
    font_config = FONT_STYLE_MAP.get(font_tag, FONT_STYLE_MAP["FONT_SERIF_THIN"])
    colors = COLOR_PALETTE_MAP.get(color_tag, COLOR_PALETTE_MAP["COLOR_PASTEL_PEACH"])
    text_color = colors["primary"]
    
    font_size = font_config.get("size", 48)
    
    # Use safe font loading
    safe_font = load_font_safe(font_config.get("name", "Arial"), font_size)
    
    try:
        txt_clip = mp.TextClip(
            scene["lyric"],
            fontsize=font_size,
            color=text_color,
            font=safe_font,
            size=(int(target_size[0] * 0.85), None),
            method='caption',
            align='center',
            stroke_color=colors.get("shadow", "#000000"),
            stroke_width=font_config.get("stroke_width", 0)
        )
        
        txt_clip = txt_clip.set_duration(scene["duration"])
        txt_clip = txt_clip.set_position(('center', 'center'))
        
        return txt_clip
        
    except Exception as e:
        logger.error(f"Failed to create text clip: {str(e)}")
        # Ultimate fallback with minimal settings
        txt_clip = mp.TextClip(
            scene["lyric"],
            fontsize=48,
            color='white',
            font='Arial',  # Most basic fallback
            size=(target_size[0], target_size[1]),
            method='caption',
            align='center'
        )
        txt_clip = txt_clip.set_duration(scene["duration"]).set_position(('center', 'center'))
        return txt_clip

def apply_professional_animation(text_clip: mp.TextClip, scene: dict) -> mp.TextClip:
    """Apply professional animation based on style"""
    rendering_data = scene["rendering_data"]
    animation_tag = rendering_data.get("animation_tag", "float_fade")
    
    if animation_tag.startswith("ANIMATION_"):
        animation_tag = animation_tag.replace("ANIMATION_", "").lower()
    
    logger.debug(f"Applying animation: {animation_tag}")
    
    try:
        if animation_tag in ANIMATION_FUNCTION_MAP:
            animation_func = ANIMATION_FUNCTION_MAP[animation_tag]
            result = animation_func(
                text_clip, 
                scene["duration"], 
                rendering_data.get("intensity", "medium")
            )
            return result
        else:
            logger.warning(f"Animation {animation_tag} not found, using fallback")
            return text_clip.fadein(0.5).fadeout(0.5)
    except Exception as e:
        logger.warning(f"Animation {animation_tag} failed: {str(e)}")
        return text_clip.fadein(0.5).fadeout(0.5)

def create_professional_video(scenes: List[dict], data: dict, style_profile: dict) -> str:
    """Create professional video with style rendering"""
    logger.info("Creating professional video with style rendering...")
    
    temp_dir = tempfile.mkdtemp()
    
    try:
        clips = []
        resolution = data.get("settings", {}).get("resolution", "1080p")
        
        resolution_map = {
            "480p": (854, 480),
            "720p": (1280, 720),
            "1080p": (1920, 1080)
        }
        target_size = resolution_map.get(resolution, (1920, 1080))
        
        for i, scene in enumerate(scenes):
            logger.info(f"Processing scene {i+1}/{len(scenes)}: {scene['lyric'][:50]}...")
            
            bg_clip = create_background_clip(scene, target_size, temp_dir, i)
            text_clip = create_professional_text_overlay(scene, target_size)
            
            try:
                animated_text = apply_professional_animation(text_clip, scene)
            except Exception as e:
                logger.warning(f"Animation failed, using fallback: {str(e)}")
                animated_text = text_clip.set_position(('center', 'center'))
            
            final_clip = CompositeVideoClip([bg_clip, animated_text])
            clips.append(final_clip)
        
        if clips:
            video = mp.concatenate_videoclips(clips, method="compose")
            
            output_path = os.path.join(temp_dir, "output.mp4")
            
            video.write_videofile(
                output_path,
                fps=24,
                codec="libx264",
                audio_codec=None,
                remove_temp=True,
                verbose=False,
                logger=None,
                threads=4,
                preset='fast',
                bitrate='5000k'
            )
            
            logger.info(f"Video created: {output_path}")
            return output_path
        else:
            raise ValueError("No scenes to create video from")
            
    except Exception as e:
        logger.error(f"Video creation failed: {str(e)}")
        logger.error(traceback.format_exc())
        raise

def upload_to_cloudinary(video_path: str, data: dict) -> dict:
    """Upload video to Cloudinary or return local file info"""
    logger.info(f"Processing video: {video_path}")
    
    cloud_name = os.getenv("CLOUDINARY_CLOUD_NAME")
    api_key = os.getenv("CLOUDINARY_API_KEY")
    api_secret = os.getenv("CLOUDINARY_API_SECRET")
    
    if not all([cloud_name, api_key, api_secret]):
        logger.warning("Cloudinary credentials not configured. Returning local file info.")
        
        try:
            video = mp.VideoFileClip(video_path)
            duration = video.duration
            video.close()
        except:
            duration = 0
        
        return {
            "secure_url": f"file://{video_path}",
            "public_id": f"local-test-{int(time.time())}",
            "duration": duration,
            "format": "mp4",
            "local_path": video_path
        }
    
    try:
        logger.info(f"Uploading video to Cloudinary: {video_path}")
        
        public_id = f"lyric-videos/{data.get('jobId', f'video-{int(time.time())}')}"
        
        upload_result = cloudinary.uploader.upload(
            video_path,
            resource_type="video",
            public_id=public_id,
            folder="lyric-videos",
            overwrite=True,
            timeout=300
        )
        
        logger.info(f"Upload successful: {upload_result['secure_url']}")
        return upload_result
        
    except Exception as e:
        logger.error(f"Cloudinary upload failed: {str(e)}")
        return {
            "secure_url": f"file://{video_path}",
            "public_id": f"local-fallback-{int(time.time())}",
            "duration": 0,
            "format": "mp4",
            "local_path": video_path,
            "error": str(e)
        }

def cleanup_temp_files(video_path: str):
    """Cleanup temporary files"""
    try:
        if os.path.exists(video_path):
            os.remove(video_path)
        video_dir = os.path.dirname(video_path)
        if os.path.exists(video_dir) and not os.listdir(video_dir):
            os.rmdir(video_dir)
    except Exception as e:
        logger.warning(f"Cleanup failed: {str(e)}")

def send_progress_update(data: dict, progress: int, message: str):
    """Send progress update to webhook"""
    if data.get("webhook_url") and REQUESTS_AVAILABLE:
        try:
            import requests
            task_id = beam.context.task_id
            requests.post(
                data["webhook_url"],
                json={
                    "job_id": task_id,
                    "status": "processing",
                    "progress": progress,
                    "message": message,
                    "logs": [f"[{progress}%] {message}"]
                },
                timeout=5
            )
        except Exception as e:
            logger.warning(f"Failed to send progress update: {str(e)}")
    elif data.get("webhook_url") and not REQUESTS_AVAILABLE:
        logger.warning("Cannot send progress update: requests library not available")

def send_completion_webhook(webhook_url: str, data: dict):
    """Send completion webhook"""
    if not REQUESTS_AVAILABLE:
        logger.warning("Cannot send completion webhook: requests library not available")
        return
    
    try:
        import requests
        task_id = beam.context.task_id
        webhook_data = {
            "job_id": task_id,
            **data
        }
        response = requests.post(
            webhook_url,
            json=webhook_data,
            headers={"Content-Type": "application/json"},
            timeout=10
        )
        logger.info(f"Completion webhook sent: {response.status_code}")
    except Exception as e:
        logger.warning(f"Failed to send completion webhook: {str(e)}")

def verify_environment():
    """Verify that all required components are available"""
    logger.info("Verifying environment setup...")
    
    # Check ImageMagick
    try:
        import subprocess
        result = subprocess.run(["convert", "--version"], capture_output=True, text=True)
        if "ImageMagick" in result.stdout:
            logger.info("✓ ImageMagick is available")
            logger.debug(f"ImageMagick version: {result.stdout.split()[2]}")
        else:
            logger.warning("⚠ ImageMagick not found in PATH")
    except Exception as e:
        logger.warning(f"⚠ Could not verify ImageMagick: {e}")
    
    # Check fonts - FIXED: Changed font_paths to FONT_PATHS
    font_files = []
    for font_path in FONT_PATHS:
        if os.path.exists(font_path):
            fonts = [f for f in os.listdir(font_path) if f.endswith(('.ttf', '.otf'))]
            font_files.extend(fonts)
    
    if font_files:
        logger.info(f"✓ Found {len(font_files)} font files")
    else:
        logger.warning("⚠ No font files found in expected locations")
    
    return True

def load_font_safe(font_name: str, font_size: int):
    """Safely load a font with fallbacks"""
    font_candidates = [
        font_name,
        "Arial",
        "DejaVu-Sans",
        "Liberation-Sans",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
    ]
    
    for candidate in font_candidates:
        try:
            # Try to create a temporary text clip to test the font
            test_clip = mp.TextClip("Test", font=candidate, fontsize=font_size)
            # In v2.x, we can't easily test without rendering, but this import will fail if font doesn't exist
            logger.debug(f"✓ Font candidate available: {candidate}")
            return candidate
        except Exception as e:
            logger.debug(f"✗ Font not available: {candidate} - {str(e)}")
            continue
    
    logger.warning(f"⚠ No suitable font found for {font_name}, using default")
    return "Arial"

# ============================================
# MAIN VIDEO GENERATION FUNCTION (DECORATOR PATTERN)
# ============================================

@beam.task_queue(
    name="vidgen-ai-professional-style-video-generation",
    image=video_gen_image, # This applies the ImageMagick fixes to the worker
    cpu=8,
    memory="64Gi",
    gpu="A10G",
    timeout=600
)
def generate_lyric_video_pro(data: dict):
    """Generate lyric video using professional style profiles"""
    try:
        # Verify environment first
        verify_environment()

        task_id = beam.context.task_id
        logger.info(f"Starting professional video generation: {task_id}")
        
        logger.info(f"Processing: {data.get('songTitle', 'Untitled')} by {data.get('artist', 'Unknown')}")
        
        def validate_input_data(data):
            required_fields = ["lyrics", "songTitle"]
            for field in required_fields:
                if field not in data:
                    raise ValueError(f"Missing required field: {field}")
        
        validate_input_data(data)
        send_progress_update(data, 5, "Initializing style profile...")
        
        style_profile = None
        def select_style_profile(data):
            requested_style = data.get("style", "").lower()
            for key, profile in STYLE_PROFILES.items():
                if requested_style and requested_style in key:
                    return profile
            return STYLE_PROFILES["dreamy_ethereal"]
        style_profile = select_style_profile(data)
        logger.info(f"Selected style: {style_profile['name']}")
        
        send_progress_update(data, 15, f"Style selected: {style_profile['name']}")
        
        scenes = generate_styled_scenes(data, style_profile)
        logger.info(f"Generated {len(scenes)} scenes")
        
        send_progress_update(data, 40, f"Created {len(scenes)} AI scenes")
        
        video_path = create_professional_video(scenes, data, style_profile)
        logger.info(f"Video created at: {video_path}")
        
        send_progress_update(data, 70, "Video rendered, uploading...")
        
        upload_result = upload_to_cloudinary(video_path, data)
        
        cleanup_temp_files(video_path)
        
        send_progress_update(data, 100, "Video generation completed!")
        
        if data.get("webhook_url"):
            send_completion_webhook(data["webhook_url"], {
                "status": "completed",
                "video_url": upload_result["secure_url"],
                "public_id": upload_result["public_id"],
                "duration": upload_result.get("duration", 0),
                "format": upload_result.get("format", "mp4"),
                "scenes": len(scenes),
                "style": style_profile["name"],
                "message": f"Video generated with {style_profile['name']} style"
            })
        
        logger.info(f"Completed successfully: {upload_result['secure_url']}")
        
        return {
            "success": True,
            "video_url": upload_result["secure_url"],
            "public_id": upload_result["public_id"],
            "duration": upload_result.get("duration", 0),
            "format": upload_result.get("format", "mp4"),
            "scenes": len(scenes),
            "style": style_profile["name"],
            "job_id": task_id,
            "metadata": {
                "resolution": data.get("settings", {}).get("resolution", "1080p"),
                "total_duration": sum(s["duration"] for s in scenes),
                "style_profile": style_profile
            }
        }
        
    except Exception as e:
        logger.error(f"Video generation failed: {str(e)}")
        logger.error(traceback.format_exc())
        
        if 'data' in locals() and data.get("webhook_url"):
            send_completion_webhook(data["webhook_url"], {
                "status": "failed",
                "error": str(e),
                "message": "Video generation failed"
            })
        
        raise e

def generate_prompt_from_lyrics(lyric_chunk: str, style_mode: str, max_keywords: int = 4) -> str:
    """
    Generate AI texture prompt from lyrics using keyword extraction
    """
    try:
        keywords = keyword_extractor.extract_keywords(lyric_chunk, max_keywords=max_keywords)
        
        if not keywords:
            mood_words = {
                "dreamy_ethereal": ["ethereal", "dreamy", "misty", "glowing", "soft"],
                "minimalist_typography": ["minimal", "clean", "simple", "elegant", "geometric"],
                "space_cosmic": ["cosmic", "stellar", "nebula", "galaxy", "stars"],
                "lofi_nostalgia": ["vintage", "retro", "warm", "grainy", "nostalgic"],
                "industrial_grunge": ["gritty", "urban", "industrial", "textured", "raw"]
            }
            keywords = mood_words.get(style_mode, ["abstract", "texture", "pattern", "background"])
        
        base_prompt = f"Abstract, looping background texture, high resolution, 4k, cinematic, style of {style_mode}"
        keyword_prompt = ", ".join(keywords)
        
        full_prompt = f"{base_prompt}, {keyword_prompt}"
        
        logger.debug(f"Generated prompt from lyrics: {full_prompt[:100]}...")
        return full_prompt
        
    except Exception as e:
        logger.warning(f"Failed to generate prompt from lyrics: {e}")
        return f"Abstract, looping background texture, high resolution, 4k, cinematic, style of {style_mode}, lyrical abstract art"

def verify_environment():
    import subprocess
    try:
        # Check if ImageMagick is actually allowed to read/write
        result = subprocess.run(["convert", "-version"], capture_output=True, text=True)
        logger.info(f"ImageMagick check: {result.stdout.splitlines()[0]}")
    except Exception as e:
        logger.error(f"ImageMagick not found: {e}")

class PhysicsAnimator:
    """Physics-based animation system using mathematical models"""
    
    GRAVITY = 9.8
    SPRING_CONSTANT = 100.0
    DAMPING_RATIO = 0.7
    
    @staticmethod
    def _apply_transform(frame, dx=0, dy=0, scale=1.0, angle=0.0, opacity=1.0):
        """Apply transformations to a frame"""
        if frame is None:
            return None
            
        h, w = frame.shape[:2]
        center = (w // 2, h // 2)
        
        # Create transformation matrix
        M = cv2.getRotationMatrix2D(center, angle, scale)
        M[0, 2] += dx
        M[1, 2] += dy
        
        # Apply transformation
        transformed = cv2.warpAffine(frame, M, (w, h))
        
        # Apply opacity if not 1.0
        if opacity != 1.0:
            if len(transformed.shape) == 3:
                # For color images
                transformed = (transformed * opacity).astype(np.uint8)
            else:
                # For grayscale
                transformed = (transformed * opacity).astype(np.uint8)
        
        return transformed
    
    @classmethod
    def _apply_physics_effect(cls, get_frame, t, physics_func):
        frame = get_frame(t)
        if frame is None:
            return None
            
        # Apply physics effect to get transformation parameters
        params = physics_func(t)
        if params:
            # Extract transformation parameters
            dx = params.get('dx', 0)
            dy = params.get('dy', 0)
            scale = params.get('scale', 1.0)
            angle = params.get('angle', 0.0)
            opacity = params.get('opacity', 1.0)
            
            # Apply the transformation
            frame = cls._apply_transform(frame, dx, dy, scale, angle, opacity)
        
        return frame
    
    @classmethod
    def animate_float_fade_sine(cls, clip):
        def physics_effect(t):
            y_offset = int(20 * math.sin(t / 10.0))
            # Return parameters to apply
            return {'dy': y_offset}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_jitter_damp(cls, clip):
        def physics_effect(t):
            amplitude = 20 * math.exp(-t * 5)
            frequency = 30
            x_offset = int(amplitude * math.sin(t * frequency))
            y_offset = int(amplitude * math.cos(t * frequency))
            return {'dx': x_offset, 'dy': y_offset}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_type_pulse(cls, clip):
        def physics_effect(t):
            damping = math.exp(-t * 3)
            natural_freq = 20
            scale_factor = 1.0 + damping * math.sin(t * natural_freq) * 0.1
            return {'scale': scale_factor}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_wobble_spring(cls, clip):
        def physics_effect(t):
            wobble_x = int(10 * (math.sin(t * 1.5) + 0.5 * math.cos(t * 2.2)))
            wobble_y = int(8 * (math.cos(t * 1.3) + 0.7 * math.sin(t * 1.9)))
            rotation = 2 * (math.sin(t * 1.7) + math.cos(t * 1.4))
            return {'dx': wobble_x, 'dy': wobble_y, 'angle': rotation}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_shatter_collision(cls, clip):
        def physics_effect(t):
            if t < 0.2:
                velocity = 100 * (1 - math.exp(-t * 15))
            else:
                snap_time = t - 0.2
                velocity = -80 * math.exp(-snap_time * 8) * math.sin(snap_time * 20)
            
            x_offset = int(velocity * math.sin(t * 5))
            y_offset = int(velocity * math.cos(t * 5))
            
            # Also add some rotation on impact
            rotation = 5 * velocity * 0.01
            return {'dx': x_offset, 'dy': y_offset, 'angle': rotation}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_slide_inertia(cls, clip):
        def physics_effect(t):
            if t < 0.3:
                position = 150 * (1 - math.exp(-t * 10))
            else:
                settle_time = t - 0.3
                overshoot = 30 * math.exp(-settle_time * 6) * math.sin(settle_time * 15)
                position = 120 + overshoot
            
            return {'dx': position}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_depth_gravity(cls, clip):
        def physics_effect(t):
            gravity = cls.GRAVITY * 10
            
            if t < 0.5:
                distance = 0.5 * gravity * t * t
            else:
                fall_time = 0.5
                impact_velocity = gravity * fall_time
                bounce_time = t - fall_time
                
                distance = (impact_velocity * bounce_time - 
                           0.5 * gravity * bounce_time * bounce_time)
                distance *= math.exp(-bounce_time * 3)
            
            y_offset = int(min(distance, 100))
            
            # Add scale effect for depth perception
            scale = 1.0 - (min(distance, 100) * 0.002)
            return {'dy': y_offset, 'scale': scale}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_lofi_wobble(cls, clip):
        def physics_effect(t):
            damping = 0.5 + 0.5 * math.exp(-t * 0.5)
            frequency = 0.3
            roll = damping * math.sin(2 * math.pi * frequency * t)
            y_offset = int(3 * roll)
            
            # Add subtle rotation for VHS effect
            rotation = 0.2 * roll
            return {'dy': y_offset, 'angle': rotation}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_particle_decay(cls, clip):
        def physics_effect(t):
            tau = 0.5
            opacity = math.exp(-t / tau)
            
            # Add some random drift
            drift_x = 10 * (1 - opacity) * math.sin(t * 3)
            drift_y = 10 * (1 - opacity) * math.cos(t * 2.5)
            return {'dx': drift_x, 'dy': drift_y, 'opacity': opacity}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))
    
    @classmethod
    def animate_abstract_breath(cls, clip):
        def physics_effect(t):
            breath_rate = 0.2
            scale = 1.0 + 0.1 * math.sin(2 * math.pi * breath_rate * t)
            
            # Add subtle rotation
            rotation = 1 * math.sin(2 * math.pi * breath_rate * t * 0.5)
            return {'scale': scale, 'angle': rotation}
        
        return clip.fl(lambda get_frame, t: cls._apply_physics_effect(get_frame, t, physics_effect))

PHYSICS_ANIMATIONS = {
    'PHYSICS_FLOAT_FADE': (
        PhysicsAnimator.animate_float_fade_sine,
        'Ethereal Flow - Simple Harmonic Motion',
        'y(t) = A·sin(ωt)'
    ),
    'PHYSICS_JITTER_SHAKE': (
        PhysicsAnimator.animate_jitter_damp,
        'Damped Impact - Damped Oscillator',
        'A(t) = A₀·e^(-ζωt)·sin(ωt)'
    ),
    'PHYSICS_WIPE_TYPE': (
        PhysicsAnimator.animate_type_pulse,
        'Energy Pulse - Underdamped Spring',
        'x(t) = A·e^(-ζωt)·sin(ω_d·t)'
    ),
    'PHYSICS_WOBBLE_POP': (
        PhysicsAnimator.animate_wobble_spring,
        'Wobbly Spring - Superposition',
        'x(t) = Σ A_i·sin(ω_i·t + φ_i)'
    ),
    'PHYSICS_SHATTER_SHIFT': (
        PhysicsAnimator.animate_shatter_collision,
        'Fragment Collision - Elastic Impact',
        'Two-phase: Explosion + Rebound'
    ),
    'PHYSICS_SLIDE_SNAP': (
        PhysicsAnimator.animate_slide_inertia,
        'Kinetic Stop - Inertia & Overshoot',
        'x(t) = x_eq + A·e^(-βt)·sin(ωt)'
    ),
    'PHYSICS_DEPTH_FLUID': (
        PhysicsAnimator.animate_depth_gravity,
        'Weighty Drop - Free Fall with Bounce',
        'y(t) = ½gt² (fall), damped bounce'
    ),
    'PHYSICS_TYPE_FLICKER': (
        PhysicsAnimator.animate_lofi_wobble,
        'Vertical Roll - Damped Periodic',
        'A(t) = A₀·(c₁ + c₂·e^(-t/τ))·sin(2πft)'
    ),
    'PHYSICS_PARTICLE_DISSOLVE': (
        PhysicsAnimator.animate_particle_decay,
        'Cosmic Decay - Exponential Decay',
        'N(t) = N₀·e^(-t/τ)'
    ),
    'PHYSICS_PULSE_MORPH': (
        PhysicsAnimator.animate_abstract_breath,
        'Organic Breath - Constant Oscillation',
        'x(t) = A·sin(2πft)'
    ),
}

def get_physics_animation(animation_tag):
    """Get physics animation function by tag"""
    if animation_tag in PHYSICS_ANIMATIONS:
        return PHYSICS_ANIMATIONS[animation_tag][0]
    raise ValueError(f"Physics animation '{animation_tag}' not found. Available: {list(PHYSICS_ANIMATIONS.keys())}")

def list_physics_animations():
    """List all available physics animations with descriptions"""
    print("=" * 60)
    print("PHYSICS-BASED ANIMATIONS CATALOG")
    print("=" * 60)
    for tag, (_, desc, physics) in PHYSICS_ANIMATIONS.items():
        print(f"🔬 {tag}")
        print(f"   Description: {desc}")
        print(f"   Physics: {physics}")
        print(f"   Function: {PhysicsAnimator.__name__}.{_[0].__name__}")
        print("-" * 60)

def apply_physics_animation(clip, animation_tag):
    """Apply physics animation to clip"""
    animation_func = get_physics_animation(animation_tag)
    return animation_func(clip)