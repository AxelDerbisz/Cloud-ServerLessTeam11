import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyB4eB8sB7gJBVyDu57z2YAzfKwh1rElx_c",
  projectId: "team11-dev",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app, "team11-database");
