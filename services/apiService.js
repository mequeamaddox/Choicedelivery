import { auth } from '../src/firebaseConfig';

const API_BASE_URL = 'https://www.choicedeliverysc.com/wp-json/firebase/v1';

// Function to get the Firebase token
const getFirebaseToken = async () => {
    const user = auth.currentUser;
    if (user) {
        return await user.getIdToken();
    } else {
        throw new Error('No user is currently logged in.');
    }
};

// Fetch wrapper to handle requests
const fetchWithAuth = async (url, options = {}) => {
    try {
        const token = await getFirebaseToken();
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers,
            'Authorization': `Bearer ${token}`
        };
        const response = await fetch(url, { ...options, headers });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Error: ${response.status} - ${errorData.message}`);
        }
        return response.json();
    } catch (error) {
        console.error('Fetch error:', error);
        throw error;
    }
};

// API service functions
export const verifyFirebaseToken = async () => {
    try {
        const user = auth.currentUser;
        if (user) {
            const idToken = await user.getIdToken(true);
            const response = await fetch(`${API_BASE_URL}/verify`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ idToken })
            });
            if (!response.ok) {
                throw new Error(`Error verifying Firebase token: ${response.statusText}`);
            }
            return response.json();
        } else {
            throw new Error('No user is logged in');
        }
    } catch (error) {
        console.error('Error verifying Firebase token:', error);
        throw error;
    }
};

export const logout = async () => {
    try {
      await auth.signOut();
    } catch (error) {
      throw new Error('Logout failed: ' + error.message);
    }
  };
