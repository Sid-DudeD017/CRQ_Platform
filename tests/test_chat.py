import asyncio
import httpx

async def main():
    async with httpx.AsyncClient() as client:
        try:
            async with client.stream("POST", "http://127.0.0.1:8000/api/chat", json={"message": "budget"}) as response:
                print("Status:", response.status_code)
                async for chunk in response.aiter_text():
                    print(chunk, end="", flush=True)
        except Exception as e:
            print("Error:", e)

asyncio.run(main())
