from beam import PythonVersion, Image, Sandbox
import sys

# We create a simple sandbox configuration here, NOT the full App definition
sandbox = Sandbox(
    name="quickstart-test", 
    image=Image(python_version=PythonVersion.Python311)
)

sb = sandbox.create()

# Run a simple print command inside the remote sandbox to check connectivity
print("=> Checking connection...")
result = sb.process.run_code("print('hello from the sandbox!')").result
print(result)

# In a real scenario, you'd run your video function here:
# result = sb.process.run_code("import app; print(app.my_video_function())").result

sb.terminate()