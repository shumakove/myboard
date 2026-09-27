# Временная заглушка api (T0.1), заменяется apps/api в T0.2.
FROM python:3.12-slim
WORKDIR /app
RUN pip install --no-cache-dir "fastapi==0.118.0" "uvicorn[standard]==0.37.0"
COPY main.py .
EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
