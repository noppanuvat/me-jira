FROM node:24-alpine

# Install nginx
RUN apk add --no-cache nginx

# Create app and nginx directories
WORKDIR /app
RUN mkdir -p /run/nginx

# Copy backend server
COPY jira-proxy-server.js /app/

# Copy frontend files to nginx html folder
COPY jira_ai_requirement_analyzer_dev_qa.html /usr/share/nginx/html/
COPY jira_ai_requirement_analyzer_dev_qa.css /usr/share/nginx/html/

# Copy nginx config and entrypoint script
COPY nginx.conf /etc/nginx/nginx.conf
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

# Expose frontend & proxy port
EXPOSE 8787

# Run entrypoint script
CMD ["/app/entrypoint.sh"]
