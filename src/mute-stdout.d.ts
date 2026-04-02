declare module 'mute-stdout' {
	const muteStdout: {
		mute: () => void;
		unmute: () => void;
	};

	export default muteStdout;
}
