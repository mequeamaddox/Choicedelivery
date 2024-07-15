// authService.js (you can create this file if it doesn't exist)
import { getAuth } from 'firebase/auth';

export const getFirebaseToken = async () => {
    const auth = getAuth();
    const user = auth.currentUser;

    if (user) {
        try {
            const idToken = await user.getIdToken(true);
            return idToken;
        } catch (error) {
            console.error('Error getting ID token:', error);
            throw error;
        }
    } else {
        throw new Error('No user is signed in');
    }
};
