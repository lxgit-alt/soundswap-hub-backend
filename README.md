# SoundSwap Backend

Backend API server for SoundSwap platform, handling email services and user management.

## Features

- 📧 Professional welcome emails for new users
- 🎵 Subscription-aware email templates
- 🛡️ Secure email service with Gmail integration
- 🎨 Beautiful HTML email templates with responsive design

## Setup

1. **Install Dependencies**
   ```bash
   cd backend
   npm install
   ```

2. **Environment Configuration**
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` and configure:
   - `GMAIL_USER`: Your Gmail address
   - `GMAIL_PASS`: Gmail app password (not your regular password)
   - `CLIENT_URL`: Your frontend URL (e.g., http://localhost:3000)

3. **Gmail App Password Setup**
   - Go to your Google Account settings
   - Enable 2-Factor Authentication
   - Generate an App Password for "Mail"
   - Use this app password in `GMAIL_PASS`

4. **Start the Server**
   ```bash
   # Development
   npm run dev
   
   # Production
   npm start
   ```

## API Endpoints

### POST `/api/send-welcome-email`
Sends a welcome email to new users.

**Request Body:**
```json
{
  "email": "user@example.com",
  "name": "John Doe",
  "subscription": "Free",
  "isFounder": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Welcome email sent successfully"
}
```

## Email Templates

Templates are stored in `templates/` directory using Handlebars syntax:

- `welcome.hbs`: Welcome email for new users
- `founderActivation.hbs`: Founder activation email

## Directory Structure

```
backend/
├── src/
│   ├── routes/
│   │   └── emailRoutes.js
│   ├── utils/
│   │   └── emailService.js
│   └── server.js
├── templates/
│   └── welcome.hbs
├── package.json
├── .env.example
└── README.md
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `PORT` | Server port | No (default: 3001) |
| `NODE_ENV` | Environment | No (default: development) |
| `CLIENT_URL` | Frontend URL | Yes |
| `GMAIL_USER` | Gmail address | Yes |
| `GMAIL_PASS` | Gmail app password | Yes |
| `SUPPORT_EMAIL` | Support email | No (falls back to GMAIL_USER) |

## Development

The server automatically sends welcome emails when users sign up through the frontend. The emails are:

- 🎨 Professionally designed with SoundSwap branding
- 📱 Mobile-responsive
- 🎵 Subscription-aware (different content for different plans)
- 👑 Founder-specific content for founder members

## Troubleshooting

**Email not sending?**
- Check Gmail app password is correct
- Verify 2FA is enabled on your Google account
- Check firewall/network restrictions

**Template not loading?**
- Ensure `templates/` directory exists
- Check file permissions
- Verify Handlebars template syntax