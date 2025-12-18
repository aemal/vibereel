1. Enable SSH and test if it works in your MacBook:
```
sudo systemsetup -setremotelogin on           
ssh localhost                                                                                           
```

2. Set up SSH key in your MacBook:
```
cd ~/.ssh 
ssh-keygen -t ed25519 -f ~/.ssh/id_n8n-18h
cat ~/.ssh/id_n8n-18h.pub >> ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys
```

3. Start n8n:                                                                                                                          
docker-compose up -d                                                                                                                     

4. In the n8n SSH node:
  - Host: host.docker.internal
  - Port: 22                                                                                                                             
  - Username: Your Mac username                                                                                                          
  - Authentication: Use the SSH key from /home/node/.ssh/id_n8n-18h  


Trouble Shooting:
1. Make sure that you have Remote Login from the General tab in the System Settings of your MacBook enabled.