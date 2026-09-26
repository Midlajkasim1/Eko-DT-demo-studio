# FIN Connector Backend

This is a FastAPI-based backend server designed to act as a connector between the FIN Framework and the IFC Digital Twin Viewer frontend. It exposes a REST API for the frontend to consume, providing real-time equipment data, power histories, and building information.

## Features

- **SCRAM-SHA-256 Authentication**: Securely logs into the FIN server.
- **Background Polling**: Automatically fetches real-time equipment data every 30 seconds.
- **Data Aggregation**: Computes building-wide sensor averages (temperature, humidity, CO2) and builds Fault Detection and Diagnostics (FDD) summaries.
- **Interactive Documentation**: Auto-generated Swagger UI for easy API exploration.

## Prerequisites

- Python 3.8 or higher
- `pip` (Python package installer)

## Setup and Installation

1. Navigate to the `backend` directory (if you aren't already there):
   ```bash
   cd d:\Projects\ifcviewer\backend
   ```

2. *(Optional but recommended)* Create and activate a virtual environment to keep dependencies isolated:
   ```bash
   python -m venv venv
   
   # Activate on Windows:
   venv\Scripts\activate
   
   # Activate on macOS/Linux:
   source venv/bin/activate
   ```

3. Install the required dependencies:
   ```bash
   pip install -r requirements.txt
   ```

## Configuration

The backend reads its configuration from `config.json` located in the `backend` directory. This file dictates:
- `project_name`
- `fin_server_url`
- Various endpoints for real-time and power data.
- Live point IDs to be fetched.

## Running the Server

Start the FastAPI development server with live-reloading enabled using Uvicorn:

```bash
uvicorn main:app --reload
```

The server will start up and run locally, typically accessible at `http://127.0.0.1:8000`.

## API Documentation

FastAPI automatically generates interactive API documentation. Once the server is running, you can explore the available endpoints by visiting:

**[http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)**

### Key Endpoints

- `POST /api/fin/login`: Authenticate with the FIN server using your credentials.
- `GET /api/fin/status`: Check connection status.
- `GET /api/fin/equip-live`: Retrieve live, flattened equipment data including alarms and BIM IDs.
- `GET /api/fin/power-live`: Retrieve live power metrics, carbon emissions, and sensor averages.
- `GET /api/fin/building-info`: Get full building data alongside its history.
- `POST /api/fin/logout`: Disconnect the current session.
