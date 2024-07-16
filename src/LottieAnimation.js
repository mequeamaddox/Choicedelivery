import React from 'react';
import LottieView from 'lottie-react-native';
import animationData from '../assets/loading.json'; // Replace with your Lottie file path

const LottieAnimation = ({ isVisible }) => {
  if (!isVisible) return null;

  return (
    <LottieView
      source={animationData}
      autoPlay
      loop
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(255, 255, 255, 0.8)', // Optional: Background overlay
        zIndex: 9999,
      }}
    />
  );
};

export default LottieAnimation;
