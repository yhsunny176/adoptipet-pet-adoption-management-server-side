# AdoptiPet Server – Backend API

---

## Overview

AdoptiPet is a full-stack web application that streamlines the pet adoption process, connecting adopters, donors, and shelters. This repository contains the **server-side (backend) code**, which powers the RESTful API, authentication, and business logic for the platform.

The backend is built with **Node.js**, **Express.js**, and **MongoDB**, and integrates with **Firebase** for authentication and **Stripe** for secure donations.
---

## ✨ Key Features

- **User Authentication & Authorization:** JWT-based sessions, Firebase Auth integration, and role-based access (admin/user).
- **Pet Management:** CRUD operations for pet listings, including filtering, searching, and category-based queries.
- **Adoption Requests:** Submit, track, and manage adoption requests with status updates.
- **Donation Campaigns:** Create, update, and manage donation campaigns; process payments via Stripe.
- **Admin Controls:** Admin endpoints for managing users, pets, and donations.
- **Pagination & Filtering:** Efficient data retrieval for large datasets.
- **Security:** CORS, secure cookies, environment variables, and robust error handling.

---

## 🛠️ Technologies Used

- **Node.js** & **Express.js** – RESTful API and middleware
- **MongoDB** – NoSQL database for users, pets, requests, and donations
- **JWT** – Secure authentication and session management
- **Firebase Admin SDK** – Server-side Firebase operations
- **Stripe** – Payment processing for donations
- **CORS**, **dotenv**, **cookie-parser** – Security and environment management

---

## 📦 Notable NPM Packages

- `express`, `mongodb`, `jsonwebtoken`, `firebase-admin`, `stripe`
- `cors`, `dotenv`, `cookie-parser`, `nodemon`

---

## 🔒 Security

- **JWT Authentication** for API endpoints
- **Role-Based Access Control** (admin/user)
- **CORS Policy** for trusted origins
- **Secure Cookies** (HTTP-only, SameSite)
- **Environment Variables** for sensitive data

---

## API Endpoints

- **/jwt** – Generate JWT for authenticated users
- **/user, /all-users, /user/role/:email** – User management
- **/add-pet, /all-pets, /pet-detail/:id, /category-pets** – Pet management
- **/adopt-request, /adopt-request/check** – Adoption requests
- **/dashboard/**... – User dashboard endpoints for pets, requests, donations
- **/admin/**... – Admin-only endpoints for managing all data
- **/create-payment-intent, /recieved-donation** – Stripe payment integration

---

## Getting Started

### Prerequisites

- Node.js & npm
- MongoDB Atlas account
- Firebase project (for Auth)
- Stripe account (for donations)

### Installation

```bash
# Clone the repository
git clone https://github.com/Programming-Hero-Web-Course4/b11a12-server-side-yhsunny176.git

# Install dependencies
npm install

# Create a .env file and add your environment variables
MONGODB_URI=your_mongodb_uri
ACCESS_TOKEN_SECRET=your_jwt_secret
STRIPE_SK=your_stripe_secret_key
NODE_ENV=development

# Start the server
npm start
```