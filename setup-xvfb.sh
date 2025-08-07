
export DISPLAY=:99
export ELECTRON_ENABLE_LOGGING=1
export ELECTRON_DISABLE_GPU=1
XVFB_VIDEO_RESOLUTION="1024x768"

# Internal variable to store ffmpeg PID
XVFB_FFMPEG_PID=""

# Usage: recordVideo output.mp4
recordVideo() {
	local output_file="$1"
	if [ -z "$output_file" ]; then
		echo "Usage: recordVideo <output_file>"
		return 1
	fi

	echo "Recording video to $output_file"
  nohup ffmpeg -video_size "$XVFB_VIDEO_RESOLUTION" -framerate 25 -f x11grab -i :99 "$output_file" > ffmpeg.log 2>&1 &
	XVFB_FFMPEG_PID=$!
	export XVFB_FFMPEG_PID
	echo "Recording video to $output_file (PID $XVFB_FFMPEG_PID)"
}

# Usage: stopVideo
stopVideo() {
	if [ -z "$XVFB_FFMPEG_PID" ]; then
		echo "No ffmpeg recording process found."
		return 1
	fi
	kill "$XVFB_FFMPEG_PID" 2>/dev/null
	wait "$XVFB_FFMPEG_PID" 2>/dev/null
	echo "Stopped video recording (PID $XVFB_FFMPEG_PID)"
	unset XVFB_FFMPEG_PID
}

Xvfb :99 -screen 0 "${XVFB_VIDEO_RESOLUTION}x24" > /dev/null 2>&1 &

