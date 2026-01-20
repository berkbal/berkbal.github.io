FROM nginx:stable-alpine3.23-perl

COPY favicon.ico index.html style.css /usr/share/nginx/html

CMD ["nginx", "-g", "daemon off;"]
