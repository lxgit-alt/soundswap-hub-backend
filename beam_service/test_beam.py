import beam

@beam.task_queue(name="vidgen-ai-professional-style-video-generation")
def test_function(data: dict):
    return {"message": "Hello from Beam", "data": data}

if __name__ == "__main__":
    # Local test
    result = test_function({"test": "data"})
    print(result)