import { initializeApp } from 'firebase/app';
import { initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore'; // Import Firestore
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
    apiKey: "AIzaSyDJnDs8ocgCf-heHB-gCxOsDw8DFBsqtio",
    authDomain: "choice-delivery-drivers-app.firebaseapp.com",
    projectId: "choice-delivery-drivers-app",
    storageBucket: "choice-delivery-drivers-app.appspot.com",
    messagingSenderId: "1007364104681",
    appId: "1:1007364104681:web:0c283babd8ed74d264ab78",
    measurementId: "G-PY039QV683",
    databaseURL: "https://choice-delivery-drivers-app-default-rtdb.firebaseio.com/" // Ensure this is correctly set
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase Auth with persistence
const auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage)
});

// Initialize Realtime Database
const database = getDatabase(app);

const firestore = getFirestore(app); // Initialize Firestore


export { auth, database, firestore };
